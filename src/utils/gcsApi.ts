import * as fs from 'fs';
import * as path from 'path';

import {
  Bucket,
  Storage,
  UploadOptions as GCSUploadOptions,
} from '@google-cloud/storage';
import * as ConsolaRaw from 'consola';
import { isDryRun } from 'dryrun';

import { logger as loggerRaw } from '../logger';
import { reportError } from './errors';
import { checkEnvForPrerequisite, RequiredConfigVar } from './env';

let logger: typeof ConsolaRaw;

const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_UPLOAD_METADATA = { cacheControl: `public, max-age=300` };

const IS_DRY_RUN = isDryRun();

/**
 * Mapping between file extension regexps and the corresponding content type
 * that will be set.
 */
const CONTENT_TYPES_EXT: Array<[RegExp, string]> = [
  [/\.js$/, 'application/javascript; charset=utf-8'],
  [/\.js\.map$/, 'application/json; charset=utf-8'],
];

/**
 * Is this bucket being used as an artifact store or a target?
 */
export const enum BucketRole {
  /** Artifact storage (used in both `prepare` and `publish`) */
  STORE = 'artifact store',
  /** Destination for `publish` */
  TARGET = 'target',
}

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
  /** Role (is this being used as an artifact store or a target?) */
  bucketRole: BucketRole;
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
  metadata: any;
}

/**
 * Abstraction for a GCS bucket
 */
export class GCSBucket {
  /** Bucket name */
  public readonly bucketName: string;
  /** CGS Client */
  private readonly bucket: Bucket;

  public constructor(config: GCSBucketConfig) {
    const {
      bucketName,
      projectId,
      credentials,
      bucketRole,
      maxRetries = DEFAULT_MAX_RETRIES,
    } = config;

    logger = loggerRaw.withScope(`[gcs ${bucketRole}]`);

    this.bucketName = bucketName;
    this.bucket = new Bucket(
      new Storage({
        credentials,
        maxRetries,
        projectId,
      }),
      bucketName
    );
  }

  /**
   * Pulls GCS redentials out of the environment, where they can be stored either
   * as a path to a JSON file or as a JSON string.
   *
   * @returns An object containing the credentials
   */
  public static getGCSCredsFromEnv = (
    bucketRole: BucketRole
  ): { [key: string]: string } => {
    // tslint:disable: object-literal-sort-keys
    const jsonVar: RequiredConfigVar =
      bucketRole === BucketRole.STORE
        ? { name: 'CRAFT_GCS_STORE_CREDENTIALS_JSON' }
        : {
            name: 'CRAFT_GCS_TARGET_CREDENTIALS_JSON',
            legacyName: 'CRAFT_GCS_CREDENTIALS_JSON',
          };
    const filepathVar: RequiredConfigVar =
      bucketRole === BucketRole.STORE
        ? { name: 'CRAFT_GCS_STORE_CREDENTIALS_PATH' }
        : {
            name: 'CRAFT_GCS_TARGET_CREDENTIALS_PATH',
            legacyName: 'CRAFT_GCS_CREDENTIALS_PATH',
          };

    // make sure we have at least one of the necessary variables
    checkEnvForPrerequisite(jsonVar, filepathVar);

    const gcsCredsJson = process.env[jsonVar.name];
    const gcsCredsPath = process.env[filepathVar.name];

    // necessary in case we're doing a dry run, in which case missing
    // credentials will log an error but not throw
    let configRaw = '';

    if (gcsCredsJson) {
      logger.debug(`Using configuration from ${jsonVar.name}`);
      configRaw = gcsCredsJson;
    } else if (gcsCredsPath) {
      logger.debug(`Using configuration located at ${filepathVar.name}`);
      if (!fs.existsSync(gcsCredsPath)) {
        reportError(`File does not exist: ${gcsCredsPath}`);
      }
      configRaw = fs.readFileSync(gcsCredsPath).toString();
    } else {
      const errorMsg =
        `GCS credentials not found! Please provide the path to the ` +
        `configuration via environment variable ${filepathVar.name}, or ` +
        `specify the entire configuration in ${jsonVar.name}.`;
      reportError(errorMsg);
    }

    let creds: { [key: string]: string } = {};
    try {
      creds = JSON.parse(configRaw);
    } catch (err) {
      reportError('Error parsing JSON credentials');
    }

    for (const field of ['project_id', 'client_email', 'private_key']) {
      if (!creds[field]) {
        reportError(`GCS credentials missing ${field}!`);
      }
    }
    return creds;
  };

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
    uploadConfig: Pick<
      Required<GCSUploadOptions>,
      'destination' | 'metadata' | 'gzip'
    >
  ): Promise<void> {
    const destinationFilePath = uploadConfig.destination as string;
    if (!destinationFilePath) {
      return Promise.reject(
        new Error(
          `Can't upload file at ${localFilePath} - no destination path specified!`
        )
      );
    }

    const destinationPath = path.dirname(destinationFilePath);
    const filename = path.basename(localFilePath);
    // const fileUploadConfig: GCSUploadOptions = { ...uploadConfig };
    // const contentType = this.detectContentType(filename);
    // if (contentType) {
    //   fileUploadConfig.contentType = contentType;
    // }
    const fileUploadConfig: GCSUploadOptions = {
      ...uploadConfig,
      contentType: this.detectContentType(filename),
    };

    logger.debug(
      `Uploading ${filename} to ${destinationPath}. Upload options: ${JSON.stringify(
        fileUploadConfig
      )}`
    );
    if (!IS_DRY_RUN) {
      try {
        await this.bucket.upload(localFilePath, fileUploadConfig);
      } catch (err) {
        logger.error(`Unable to upload ${filename} to ${destinationFilePath}!`);
        throw err;
      }
      logger.info(`Uploaded ${filename} to ${destinationFilePath}`);
      // TODO (kmclb) replace this with a `craft download` command once that's a thing
      logger.info(
        `It can be downloaded by running`,
        `\`gsutil cp gs://${this.bucketName}${destinationFilePath} <destination-path>\``
      );
    } else {
      logger.info(`[dry-run] Skipping upload for ${filename}`);
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
    const uploadConfig = {
      gzip: true,
      metadata: destinationPath.metadata || DEFAULT_UPLOAD_METADATA,

      // Including `destination` here (and giving it the value we're giving it)
      // is a little misleading, because this isn't actually the full path we'll
      // pass to the `uploadArtifactFromPath` method (that one will contain the
      // filename as well). Putting the filename-agnostic version here so that
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
