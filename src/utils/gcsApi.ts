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
import { RemoteArtifact } from '../artifact_providers/base';

const DEFAULT_MAX_RETRIES = 5;
export const DEFAULT_UPLOAD_METADATA = { cacheControl: `public, max-age=300` };

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
 * Path within a given bucket, to which files can be uploaded or from which
 * files can be downloaded.
 *
 * When used for uploading, can include metadata to be associated with all of
 * the files uploaded to this path.
 */
export interface BucketPath {
  /** Path inside the bucket */
  path: string;
  /** If uploading, metadata to be associated with uploaded files */
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
        logger.debug(
          `Detected \`${artifactName}\` to be of type \`${contentType}\`.`
        );
        return contentType;
      }
    }
    logger.debug(`Unable to detect content type for \`${artifactName}\`.`);
    return undefined;
  }

  /**
   * Uploads the artifact at the given local path to the given path on the
   * bucket
   *
   * @param artifactLocalPath Local path to the artifact to be uploaded
   * @param bucketPath Destination path with associated metadata
   */
  public async uploadArtifact(
    artifactLocalPath: string,
    bucketPath: BucketPath
  ): Promise<void> {
    const filename = path.basename(artifactLocalPath);
    const pathInBucket = bucketPath.path;

    if (!artifactLocalPath) {
      reportError(
        `Unable to upload file \`${filename}\` - ` +
          `no local path to file specified!`
      );
    }

    const contentType = this.detectContentType(filename);
    const uploadConfig: GCSUploadOptions = {
      destination: path.join(pathInBucket, filename),
      gzip: true,
      metadata: bucketPath.metadata || DEFAULT_UPLOAD_METADATA,
      ...(contentType && { contentType }),
    };

    if (!isDryRun()) {
      logger.debug(
        `Attempting to upload \`${filename}\` to \`${pathInBucket}\`.`
      );

      try {
        await this.bucket.upload(artifactLocalPath, uploadConfig);
      } catch (err) {
        reportError(`Encountered an error while uploading \`${filename}\`:
        ${err}`);
      }

      // TODO (kmclb) replace this with a `craft download` command once that's a thing
      logger.debug(
        `Success! It can be downloaded by running`,
        `\`gsutil cp ${path.join(
          'gs://',
          this.bucketName,
          pathInBucket,
          filename
        )} <path-to-download-location>\``
      );
    } else {
      logger.info(`[dry-run] Skipping upload for \`${filename}\``);
    }
  }

  /**
   * Downloads a file stored on the artifact provider
   *
   * @param downloadFilepath Path to the file within the bucket, including
   * filename
   * @param destinationDirectory Path to directory into which to download the
   * file
   * @param destinationFilename Name to give the downloaded file, if different from its
   * name on the artifact provider
   * @returns Path to the downloaded file
   */
  public async downloadArtifact(
    downloadFilepath: string,
    destinationDirectory: string,
    destinationFilename: string = path.basename(downloadFilepath)
  ): Promise<string> {
    if (!fs.existsSync(destinationDirectory)) {
      reportError(
        `Unable to download \`${destinationFilename}\` to ` +
          `\`${destinationDirectory}\` - directory does not exist!`
      );
    }

    if (!isDryRun()) {
      logger.debug(
        `Attempting to download \`${destinationFilename}\` to \`${destinationDirectory}\`.`
      );

      try {
        await this.bucket.file(downloadFilepath).download({
          destination: path.join(destinationDirectory, destinationFilename),
        });
      } catch (err) {
        reportError(`Encountered an error while downloading \`${destinationFilename}\`:
          ${err}`);
      }

      logger.debug(`Success!`);
    } else {
      logger.info(`[dry-run] Skipping download for \`${destinationFilename}\``);
    }

    return path.join(destinationDirectory, destinationFilename);
  }
}
