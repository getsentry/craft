import * as fs from 'fs';
import * as path from 'path';

import * as googleStorage from '@google-cloud/storage';
import { Artifact } from '@zeus-ci/sdk';
import { shouldPerform } from 'dryrun';
import * as _ from 'lodash';

import loggerRaw from '../logger';
import { TargetConfig } from '../schemas/project_config';
import { ZeusStore } from '../stores/zeus';
import { forEachChained } from '../utils/async';
import { reportError } from '../utils/errors';
import { BaseTarget } from './base';

const logger = loggerRaw.withScope('[gcs]');

/**
 * Configuration options for the Github target
 */
export interface GcsTargetConfig extends TargetConfig {
  bucket: string;
  bucketPaths: string[];
  serviceAccountConfig: object;
  projectId: string;
  maxCacheAge: number;
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
    const gcsConfigPath = process.env.CRAFT_GCS_CREDENTIALS_PATH || '';
    if (!gcsConfigPath) {
      let errorMsg = 'Path to GCS service account is not provided!';
      errorMsg +=
        'Please provide the path via environment variable CRAFT_GCS_CREDENTIALS_PATH';
      reportError(errorMsg);
    }
    if (!fs.existsSync(gcsConfigPath)) {
      reportError(`File does not exist: ${gcsConfigPath}`);
    }
    const serviceAccountConfig = JSON.parse(
      fs.readFileSync(gcsConfigPath).toString()
    );

    const bucket = this.config.bucket;
    if (!bucket && typeof bucket !== 'string') {
      reportError('No GCS bucket provided!');
    }

    let bucketPaths: string[] = [];
    const bucketPathsRaw = this.config.paths;
    if (!bucketPathsRaw) {
      reportError('No bucket paths provided!');
    } else if (typeof bucketPathsRaw === 'string') {
      bucketPaths = [bucketPathsRaw];
    } else if (
      Array.isArray(bucketPathsRaw) &&
      bucketPathsRaw.length > 0 &&
      bucketPathsRaw.every(p => typeof p === 'string')
    ) {
      bucketPaths = bucketPathsRaw;
    } else {
      reportError('Cannot validate bucketPaths!');
    }

    const projectId = serviceAccountConfig.project_id;
    if (!projectId) {
      reportError('Cannot find project ID in the service account!');
    }

    const maxCacheAge = this.config.maxCacheAge;
    if (typeof maxCacheAge !== 'number') {
      reportError(
        `GCS target, invalid value for maxCacheAge: "${maxCacheAge}"`
      );
    }

    return {
      bucket,
      bucketPaths,
      maxCacheAge,
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
   * @param version The new version
   * @param revision The SHA revision of the new version
   */
  private getRealBucketPaths(version: string, revision: string): string[] {
    return this.gcsConfig.bucketPaths.map(templatePath => {
      // FIXME: security issues, implement safeTemplate
      // TODO: unify template variables with "brew" role
      let realPath = _.template(templatePath.trim())({
        ref: revision,
        version,
      });
      if (realPath[0] !== '/') {
        realPath = `/${realPath}`;
      }
      logger.debug(`Processed path prefix: ${realPath}`);
      return realPath;
    });
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
      logger.info(`[dry-run] Not uploading the file`);
    }
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

    const realBucketPaths = this.getRealBucketPaths(version, revision);

    const { projectId, serviceAccountConfig, bucket } = this.gcsConfig;

    const storage = new googleStorage({
      credentials: serviceAccountConfig,
      projectId,
    });

    const bucketObj: BucketObject = storage.bucket(bucket);
    const uploadOptions: GcsUploadOptions = {
      gzip: true,
      metadata: {
        cacheControl: `public, max-age=${this.gcsConfig.maxCacheAge}`,
      },
    };
    logger.debug(`Upload options: ${JSON.stringify(uploadOptions)}`);

    // We intentionally do not make all requests concurrent here
    await forEachChained(realBucketPaths, async (bucketPath: string) => {
      await Promise.all(
        artifacts.map(async (artifact: Artifact) =>
          this.uploadArtifact(artifact, bucketPath, bucketObj, uploadOptions)
        )
      );
    });
    logger.info('Upload complete.');
  }
}
