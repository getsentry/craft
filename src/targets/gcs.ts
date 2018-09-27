import * as fs from 'fs';
import * as path from 'path';

import * as googleStorage from '@google-cloud/storage';
import { Artifact } from '@zeus-ci/sdk';
import { shouldPerform } from 'dryrun';

import loggerRaw from '../logger';
import { TargetConfig } from '../schemas/project_config';
import { ZeusStore } from '../stores/zeus';
import { forEachChained } from '../utils/async';
import { reportError } from '../utils/errors';
import { renderTemplateSafe } from '../utils/strings';
import { BaseTarget } from './base';

const logger = loggerRaw.withScope('[gcs]');

const DEFAULT_UPLOAD_METADATA = { cacheControl: `public, max-age=300` };

/**
 * Bucket path with associated parameters
 */
export interface BucketDest {
  path: string;
  metadata: any;
}

/**
 * Configuration options for the Github target
 */
export interface GcsTargetConfig extends TargetConfig {
  /** Bucket name */
  bucket: string;
  /** A list of paths with their parameters */
  bucketPaths: BucketDest[];
  /** GCS service account configuration */
  serviceAccountConfig: object;
  /** Google Cloud project ID */
  projectId: string;
}

/**
 * Bucket object used in "@google-cloud/storage"
 */
interface BucketObject {
  upload(filePath: string, options: any): Promise<void>;
}

/**
 * Upload options for "@google-cloud/storage"
 */
interface GcsUploadOptions {
  gzip: boolean;
  metadata: any;
}

/**
 * Target responsible for publishing releases on Github
 */
export class GcsTarget extends BaseTarget {
  /** Target name */
  public readonly name: string = 'gcs';
  /** Target options */
  public readonly gcsConfig: GcsTargetConfig;

  public constructor(config: any, store: ZeusStore) {
    super(config, store);
    this.gcsConfig = this.getGcsConfig();
  }

  /**
   * Parses and checks configuration for the "gcs" target
   */
  protected getGcsConfig(): GcsTargetConfig {
    const gcsConfigPath = process.env.CRAFT_GCS_CREDENTIALS_PATH;
    const gcsConfigJson = process.env.CRAFT_GCS_CREDENTIALS_JSON;
    let configRaw = '';
    if (gcsConfigJson) {
      logger.debug('Using configuration from CRAFT_GCS_CREDENTIALS_JSON');
      configRaw = gcsConfigJson;
    } else if (gcsConfigPath) {
      logger.debug('Using configuration located at CRAFT_GCS_CREDENTIALS_PATH');
      if (!fs.existsSync(gcsConfigPath)) {
        reportError(`File does not exist: ${gcsConfigPath}`);
      }
      configRaw = fs.readFileSync(gcsConfigPath).toString();
    } else {
      let errorMsg = 'GCS configuration not found!';
      errorMsg +=
        'Please provide the path to the configuration via environment variable CRAFT_GCS_CREDENTIALS_PATH, ';
      errorMsg +=
        'or specify the entire configuration in CRAFT_GCS_CREDENTIALS_JSON.';
      reportError(errorMsg);
    }

    const serviceAccountConfig = JSON.parse(configRaw);

    const projectId = serviceAccountConfig.project_id;
    if (!projectId) {
      reportError('Cannot find project ID in the service account!');
    }

    const bucket = this.config.bucket;
    if (!bucket && typeof bucket !== 'string') {
      reportError('No GCS bucket provided!');
    }

    // Parse bucket paths
    let bucketPaths: BucketDest[] = [];
    const bucketPathsRaw = this.config.paths;
    if (!bucketPathsRaw) {
      reportError('No bucket paths provided!');
    } else if (typeof bucketPathsRaw === 'string') {
      bucketPaths = [
        { path: bucketPathsRaw, metadata: DEFAULT_UPLOAD_METADATA },
      ];
    } else if (Array.isArray(bucketPathsRaw) && bucketPathsRaw.length > 0) {
      bucketPathsRaw.forEach((bucketPathRaw: any) => {
        if (typeof bucketPathRaw !== 'object') {
          reportError(
            `Invalid bucket destination: ${JSON.stringify(
              bucketPathRaw
            )}. Use the object notation to specify bucket paths!`
          );
        }
        const bucketPathName = bucketPathRaw.path;
        const metadata = bucketPathRaw.metadata || DEFAULT_UPLOAD_METADATA;
        if (!bucketPathName) {
          reportError(`Invalid bucket path: ${bucketPathName}`);
        }
        if (typeof metadata !== 'object') {
          reportError(
            `Invalid metadata for path "${bucketPathName}": "${JSON.stringify(
              metadata
            )}"`
          );
        }

        bucketPaths.push({ path: bucketPathName, metadata });
      });
    } else {
      reportError('Cannot validate bucketPaths!');
    }

    return {
      bucket,
      bucketPaths,
      projectId,
      serviceAccountConfig,
    };
  }

  /**
   * Returns a list of interpolated bucket paths
   *
   * Before processing, the paths are stored as templates where variables such
   * as "version" and "ref" can be replaced.
   *
   * @param bucketPath The bucket path with the associated parameters
   * @param version The new version
   * @param revision The SHA revision of the new version
   */
  private getRealBucketPath(
    bucketPath: BucketDest,
    version: string,
    revision: string
  ): string {
    let realPath = renderTemplateSafe(bucketPath.path.trim(), {
      revision,
      version,
    });
    if (realPath[0] !== '/') {
      realPath = `/${realPath}`;
    }
    logger.debug(`Processed path prefix: ${realPath}`);
    return realPath;
  }

  /**
   * Uploads the provided artifact to the specified GCS bucket
   *
   * @param artifact Artifact to upload
   * @param bucketPath Path to upload to
   * @param bucketObj Object representing a GCS bucket
   * @param uploadOptions GCS upload options
   */
  private async uploadArtifact(
    artifact: Artifact,
    bucketPath: string,
    bucketObj: BucketObject,
    uploadOptions: GcsUploadOptions
  ): Promise<void> {
    const filePath = await this.store.downloadArtifact(artifact);
    const destination = path.join(bucketPath, path.basename(filePath));
    logger.debug(`Uploading ${path.basename(filePath)} to ${destination}...`);
    if (shouldPerform()) {
      await bucketObj.upload(filePath, { ...uploadOptions, destination });
      logger.info(`Uploaded "${destination}"`);
    } else {
      logger.info(`[dry-run] Not uploading the file "${destination}"`);
    }
  }

  /**
   * Returns a list of interpolated bucket paths
   *
   * Before processing, the paths are stored as templates where variables such
   * as "version" and "ref" can be replaced.
   *
   * @param bucketPath The bucket path with the associated parameters
   * @param bucketObj The bucket object
   * @param artifacts The list of artifacts to upload
   * @param version The new version
   * @param revision The SHA revision of the new version
   */
  private async uploadToBucketPath(
    bucketPath: BucketDest,
    bucketObj: BucketObject,
    artifacts: Artifact[],
    version: string,
    revision: string
  ): Promise<void[]> {
    const realPath = this.getRealBucketPath(bucketPath, version, revision);
    const fileUploadUptions: GcsUploadOptions = {
      gzip: true,
      metadata: bucketPath.metadata,
    };
    logger.debug(`Upload options: ${JSON.stringify(fileUploadUptions)}`);
    return Promise.all(
      artifacts.map(async (artifact: Artifact) =>
        this.uploadArtifact(artifact, realPath, bucketObj, fileUploadUptions)
      )
    );
  }

  /**
   * Uploads artifacts to Google Cloud Storage
   *
   * @param version New version to be released
   * @param revision Git commit SHA to be published
   */
  public async publish(version: string, revision: string): Promise<any> {
    const artifacts = await this.getArtifactsForRevision(revision);
    if (!artifacts.length) {
      throw new Error(
        'No artifacts to publish: please check your configuration!'
      );
    }

    const { projectId, serviceAccountConfig, bucket } = this.gcsConfig;

    const storage = new googleStorage({
      credentials: serviceAccountConfig,
      projectId,
    });

    logger.info(`Uploading to GCS bucket: "${bucket}"`);
    const bucketObj: BucketObject = storage.bucket(bucket);

    // We intentionally do not make all requests concurrent here
    await forEachChained(
      this.gcsConfig.bucketPaths,
      async (bucketPath: BucketDest) =>
        this.uploadToBucketPath(
          bucketPath,
          bucketObj,
          artifacts,
          version,
          revision
        )
    );
    logger.info('Upload complete.');
  }
}
