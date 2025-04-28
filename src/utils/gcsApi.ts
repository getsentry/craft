import * as fs from 'fs';
import * as path from 'path';

import {
  Bucket as GCSBucket,
  File as GCSFile,
  Storage as GCSStorage,
  UploadOptions as GCSUploadOptions,
} from '@google-cloud/storage';
import { isDryRun } from './helpers';

import { logger } from '../logger';
import { reportError, ConfigurationError } from './errors';
import { checkEnvForPrerequisite, RequiredConfigVar } from './env';
import { detectContentType } from './files';
import { RemoteArtifact } from '../artifact_providers/base';
import { formatJson } from './strings';

const DEFAULT_MAX_RETRIES = 5;
export const DEFAULT_UPLOAD_METADATA = { cacheControl: `public, max-age=300` };

/**
 * Configuration options for the GCS bucket
 */
export interface GCSBucketConfig {
  /** Bucket name */
  bucketName: string;
  /** ID of the project containing the bucket   */
  projectId?: string;
  /** GCS credentials - if not provided, will use Application Default Credentials */
  credentials?: { client_email: string; private_key: string };
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
  /** Credentials object for GCS client */
  credentials: { client_email: string; private_key: string };
}

/**
 * Pulls GCS redentials out of the environment, where they can be stored either
 * as a path to a JSON file or as a JSON string. If no credentials are provided,
 * returns null to indicate that Application Default Credentials should be used.
 *
 * @param jsonVar Current name (and legacy name, if app.) of env var pointing to
 * a JSON string containing GCS credentials
 * @param filepathVar Current name (and legacy name, if app.) of an env var
 * pointing to a file containing GCS credientials as JSON
 * @param logger Optional custom logger to use when logging messages to the
 * console
 *
 * @returns An object containing the credentials, or null if no credentials were provided
 */
export function getGCSCredsFromEnv(
  jsonVar: RequiredConfigVar,
  filepathVar: RequiredConfigVar
): GCSCreds | null {
  // Check if either credential source is provided
  const gcsCredsJson = process.env[jsonVar.name];
  const gcsCredsPath = process.env[filepathVar.name];

  // If no credentials are provided, return null to indicate ADC should be used
  if (!gcsCredsJson && !gcsCredsPath) {
    logger.debug('No GCS credentials provided, will use Application Default Credentials');
    return null;
  }

  let configRaw;

  if (gcsCredsJson) {
    logger.debug(`Using configuration from ${jsonVar.name}`);
    configRaw = gcsCredsJson;
  } else if (gcsCredsPath) {
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
  return {
    project_id,
    credentials: { client_email, private_key }
  };
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
    let pathInBucket = bucketPath.path;

    // Remove any potential leading forward slashes as google-cloud/storage
    // stopped normalizing paths. If you keep this, you'll end up with a path
    // like `//your/dir/and/file` instead of `/your/dir/and/file`
    // See #169 for more information.
    if (pathInBucket[0] === '/') {
      pathInBucket = pathInBucket.substring(1);
    }

    if (!artifactLocalPath) {
      reportError(
        `Unable to upload file \`${filename}\` - ` +
          `no local path to file specified!`
      );
    }

    // the underlying GCS package usually detects content-type itself, but it's
    // not always correct.
    const contentType = detectContentType(filename);

    // TODO (kmclb) in order to log more actively the times when we're
    // overriding the current content type with a different one, we need to know
    // what the current one is (which we currently don't, since all this method
    // is passed is the local filepath). In order to pass it more, we'd need to
    // return not just the path but also the entire artifact from the download
    // method called in gcsTarget.publish. In fact, when targeting GCS,  we
    // currently don't preserve the content type of artifact provider files in
    // any way, so setting it on upload is pointless. Action item: fix this.
    if (contentType) {
      logger.debug(
        `Detected \`${filename}\` to be of type \`${contentType}\`.`
      );
    }
    const metadata = {
      ...(bucketPath.metadata || DEFAULT_UPLOAD_METADATA),
      ...(contentType && { contentType }),
    };
    const uploadConfig: GCSUploadOptions = {
      destination: path.posix.join(pathInBucket, filename),
      gzip: true,
      metadata,
      resumable: !process.env.CI,
    };

    logger.trace(
      `File \`${filename}\`, upload options: ${formatJson(uploadConfig)}`
    );

    if (!isDryRun()) {
      logger.debug(
        `Attempting to upload \`${filename}\` to \`${path.posix.join(
          this.bucketName,
          pathInBucket
        )}\`.`
      );

      try {
        await this.bucket.upload(artifactLocalPath, uploadConfig);
      } catch (err) {
        reportError(`Encountered an error while uploading \`${filename}\`:
          ${formatJson(err)}`);
      }

      // TODO (kmclb) replace this with a `craft download` command once that's a thing
      logger.debug(
        `Successfully uploaded \`${filename}\`. It can be downloaded by running ` +
          `\`gsutil cp ${path.posix.join(
            'gs://',
            this.bucketName,
            pathInBucket,
            filename
          )} <path-to-download-location>\`.`
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
          ${formatJson(err)}`);
      }

      logger.debug(`Successfully downloaded \`${destinationFilename}\`.`);
    } else {
      logger.info(`[dry-run] Skipping download for \`${destinationFilename}\``);
    }

    return path.join(destinationDirectory, destinationFilename);
  }

  /**
   * Converts a GCSFile object (as it comes back from the API) into a
   * RemoteArtifact object
   *
   * @param gcsFile A GCSFile object to convert
   * @returns The corresponding RemoteArtifact object
   */
  private convertToRemoteArtifact(gcsFile: GCSFile): RemoteArtifact {
    const { name } = gcsFile;
    const filename = path.basename(name);

    const {
      size,
      updated: lastUpdated,
      contentType: mimeType,
      name: downloadFilepath,
    } = gcsFile.metadata;

    return {
      filename,
      mimeType,
      storedFile: {
        downloadFilepath,
        filename,
        lastUpdated,
        size: Number(size),
      },
    };
  }

  /**
   * Lists all artifacts associated with a given commit
   *
   * @param repoOwner The GH org containing the repo being released
   * @param repoName The name of the repo being released
   * @param revision The commit associated with the version being released
   * @returns An array of RemoteArtifact objects
   */
  public async listArtifactsForRevision(
    repoOwner: string,
    repoName: string,
    revision: string
  ): Promise<RemoteArtifact[]> {
    let filesResponse: GCSFile[][] = [[]];
    const prefix = path.posix.join(repoOwner, repoName, revision);
    logger.debug(`Looking for files starting with '${prefix}'`);
    try {
      filesResponse = await this.bucket.getFiles({ prefix });
    } catch (err) {
      reportError(
        `Error retrieving artifact list from GCS: ${formatJson(err)}`
      );
    }

    const files = filesResponse[0];
    return files.map(gcsFile => this.convertToRemoteArtifact(gcsFile));
  }
}
