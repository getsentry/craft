import * as fs from 'fs';
import * as path from 'path';

import {
  Bucket as GCSBucket,
  Storage as GCSStorage,
  UploadOptions as GCSUploadOptions,
} from '@google-cloud/storage';
import { isDryRun } from './helpers';

import { logger as loggerRaw } from '../logger';
import { reportError, ConfigurationError } from './errors';
import { checkEnvForPrerequisite, RequiredConfigVar } from './env';

const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_UPLOAD_METADATA = { cacheControl: `public, max-age=300` };

const logger = loggerRaw.withScope(`[gcs api]`);

/**
 * Mapping between file extension regexps and the corresponding content type
 * that will be set.
 */
const CONTENT_TYPES_EXT: Array<[RegExp, string]> = [
  [/\.js$/, 'application/javascript; charset=utf-8'],
  [/\.js\.map$/, 'application/json; charset=utf-8'],
];

/**
 * Configuration options for the GCS bucket
 */
export interface GCSBucketConfig {
  /** Bucket name */
  bucketName: string;
  /** ID of the project containing the bucket   */
  projectId: string;
  /** CGS credentials */
  credentials: { client_email: string; private_key: string };
  /** Maximum number of retries after unsuccessful request */
  maxRetries?: number;
}

/**
 * Bucket path with associated parameters
 */
export interface DestinationPath {
  /** Path inside the bucket to which files will be uploaded */
  path: string;
  /** Metadata to be associated with the files uploaded the path */
  metadata?: any;
}

/** Authentication credentials for GCS (pulled from env) */
interface GCSCreds {
  /** ID of the GCS project containing the bucket */
  project_id: string;
  /** Email address used to identify the service account accessing the bucket */
  client_email: string;
  /** API key for service account */
  private_key: string;
}

/**
 * Pulls GCS redentials out of the environment, where they can be stored either
 * as a path to a JSON file or as a JSON string.
 *
 * @returns An object containing the credentials
 */
export function getGCSCredsFromEnv(
  jsonVar: RequiredConfigVar,
  filepathVar: RequiredConfigVar
): GCSCreds {
  // make sure we have at least one of the necessary variables
  try {
    checkEnvForPrerequisite(jsonVar, filepathVar);
  } catch (e) {
    // ditch e and create a new error in order to override the default
    // `checkEnvForPrerequisite` error message and type
    const errorMsg =
      `GCS credentials not found! Please provide the path to the credentials ` +
      `file via environment variable ${filepathVar.name}, or specify the ` +
      `credentials as a JSON string in ${jsonVar.name}.`;
    throw new ConfigurationError(errorMsg);
  }

  const gcsCredsJson = process.env[jsonVar.name];
  const gcsCredsPath = process.env[filepathVar.name];

  let configRaw;

  if (gcsCredsJson) {
    logger.debug(`Using configuration from ${jsonVar.name}`);
    configRaw = gcsCredsJson;
  }

  // we know from the `checkEnvForPrerequisite` check earlier that one or the
  // other of the necessary env variables is defined, so if the JSON one isn't,
  // the filepath one must be (but we assert it anyway, to make the compiler
  // happy)
  else if (gcsCredsPath) {
    logger.debug(`Using configuration located at ${filepathVar.name}`);
    if (!fs.existsSync(gcsCredsPath)) {
      reportError(`File does not exist: \`${gcsCredsPath}\`!`);
    }
    configRaw = fs.readFileSync(gcsCredsPath).toString();
  }

  let parsedCofig;
  try {
    parsedCofig = JSON.parse(configRaw as string);
  } catch (err) {
    reportError(`Error parsing JSON credentials: ${err}`);
  }

  for (const field of ['project_id', 'client_email', 'private_key']) {
    if (!parsedCofig[field]) {
      reportError(`GCS credentials missing \`${field}\`!`);
    }
  }

  const { project_id, client_email, private_key } = parsedCofig;
  return { project_id, client_email, private_key };
}

/**
 * Abstraction for a GCS bucket
 */
export class CraftGCSClient {
  /** Bucket name */
  public readonly bucketName: string;
  /** CGS Client */
  private readonly bucket: GCSBucket;

  public constructor(config: GCSBucketConfig) {
    const {
      bucketName,
      projectId,
      credentials,
      maxRetries = DEFAULT_MAX_RETRIES,
    } = config;

    this.bucketName = bucketName;
    this.bucket = new GCSBucket(
      new GCSStorage({
        credentials,
        maxRetries,
        projectId,
      }),
      bucketName
    );
  }

  /**
   * Detect the content-type based on regular expressions defined in
   * CONTENT_TYPES_EXT.
   *
   * The underlying GCS package usually detects content-type itself, but it's
   * not always correct.
   *
   * @param artifactName Name of the artifact to check
   * @returns A content-type string, or undefined if the artifact name doesn't
   * have a known extension
   */
  private detectContentType(artifactName: string): string | undefined {
    for (const entry of CONTENT_TYPES_EXT) {
      const [regex, contentType] = entry;
      if (artifactName.match(regex)) {
        return contentType;
      }
    }
    return undefined;
  }

  /**
   * Uploads the artifact at the given local path to the path specified in the
   * given config object
   *
   * @param localFilePath Location of the file to be uploaded
   * @param uploadConfig Configuration for the upload including destination path
   * and metadata
   */
  private async uploadArtifactFromPath(
    localFilePath: string,
    // require these three properties out of the GCSUploadOptions interface
    uploadConfig: Pick<
      Required<GCSUploadOptions>,
      'destination' | 'metadata' | 'gzip'
    >
  ): Promise<void> {
    const destinationFilePath = uploadConfig.destination as string;
    const destinationPath = path.dirname(destinationFilePath);
    const filename = path.basename(localFilePath);

    const contentType = this.detectContentType(filename);
    const fileUploadConfig: GCSUploadOptions = {
      ...uploadConfig,
      ...(contentType && { contentType }),
    };

    logger.debug(
      `Uploading \`${filename}\` to \`${destinationPath}\`. Upload options:
        ${JSON.stringify(fileUploadConfig)}`
    );

    if (!isDryRun()) {
      try {
        await this.bucket.upload(localFilePath, fileUploadConfig);
      } catch (err) {
        reportError(
          `Error uploading \`${filename}\` to \`${destinationFilePath}\`: ${err}`
        );
      }
      logger.info(`Uploaded \`${filename}\` to \`${destinationFilePath}\``);
      // TODO (kmclb) replace this with a `craft download` command once that's a thing
      logger.info(
        `It can be downloaded by running`,
        `\`gsutil cp gs://${this.bucketName}${destinationFilePath} <destination-path>\``
      );
    } else {
      logger.info(`[dry-run] Skipping upload for \`${filename}\``);
    }
  }

  /**
   * Uploads the artifacts at the given local paths to the given destination
   * path on the bucket
   *
   * @param artifactLocalPaths A list of local paths corresponding to the
   * @param destinationPath The bucket path with associated metadata
   * artifacts to be uploaded
   */
  public async uploadArtifacts(
    artifactLocalPaths: string[],
    destinationPath: DestinationPath
  ): Promise<{}> {
    if (!destinationPath || !destinationPath.path) {
      return Promise.reject(
        new Error(
          `Can't upload file to GCS bucket ${this.bucketName} - no destination path specified!`
        )
      );
    }
    const uploadConfig = {
      gzip: true,
      metadata: destinationPath.metadata || DEFAULT_UPLOAD_METADATA,

      // Including `destination` here (and giving it the value we're giving it)
      // is a little misleading, because this isn't actually the full path we'll
      // pass to the `uploadArtifactFromPath` method (that one will contain the
      // filename as well). Putting the filename-missing version here so that
      // it gets printed out in the debug statement below; it will get replaced
      // by the correct (filename-included) value as we call the upload method
      // on each individual file.
      destination: destinationPath.path,
    };
    logger.debug(`Global upload options: ${JSON.stringify(uploadConfig)}`);

    return Promise.all(
      artifactLocalPaths.map(async (localFilePath: string) => {
        // this is the full/correct `destination` value, to replace the
        // incomplete one included above
        const destination = path.join(
          destinationPath.path,
          path.basename(localFilePath)
        );

        await this.uploadArtifactFromPath(localFilePath, {
          ...uploadConfig,
          destination,
        });
      })
    );
  }
}
