import * as fs from 'fs';
import * as path from 'path';

import { logger as loggerRaw } from '../logger';
import { TargetConfig } from '../schemas/project_config';
import { BaseTarget } from './base';
import { BaseArtifactProvider } from '../artifact_providers/base';
import { ConfigurationError, reportError } from '../utils/errors';
import {
  CompatibleRuntime,
  getRegionsFromAws,
  AwsLambdaLayerManager,
  extractRegionNames,
  getAccountFromArn,
} from '../utils/awsLambdaLayerManager';
import { createSymlinks } from '../utils/symlink';
import { withTempDir } from '../utils/files';

const logger = loggerRaw.withScope(`[aws-lambda-layer]`);

/** Config options for the "aws-lambda-layer" target. */
interface AwsLambdaTargetOptions extends TargetConfig {
  /** AWS access key ID, set as AWS_ACCESS_KEY_ID. */
  awsAccessKeyId: string;
  /** AWS secret access key, set as `AWS_SECRET_ACCESS_KEY`. */
  awsSecretAccessKey: string;
}

/**
 * Target responsible for uploading files to AWS Lambda.
 */
export class AwsLambdaLayerTarget extends BaseTarget {
  /** Target name */
  public readonly name: string = 'aws-lambda-layer';
  /** Target options */
  public readonly awsLambdaConfig: AwsLambdaTargetOptions;
  /** The directory where the runtime-specific directories are. */
  private readonly AWS_REGISTRY_DIR = 'aws-lambda-layers';
  /** File containing data fields every new version file overrides  */
  private readonly BASE_FILENAME = 'base.json';

  public constructor(
    config: TargetConfig,
    artifactProvider: BaseArtifactProvider
  ) {
    super(config, artifactProvider);
    this.awsLambdaConfig = this.getAwsLambdaConfig();
  }

  /**
   * Extracts AWS Lambda target options from the environment.
   */
  protected getAwsLambdaConfig(): AwsLambdaTargetOptions {
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      throw new ConfigurationError(
        `Cannot publish AWS Lambda Layer: missing credentials.
        Please use AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables.`
      );
    }
    return {
      awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID,
      awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    };
  }

  /**
   * Checks if the required project configuration parameters are available.
   * The required parameters are `layerName` and `compatibleRuntimes`.
   * There is also an optional parameter `includeNames`.
   */
  private checkProjectConfig(): void {
    const missingConfigOptions = [];
    if (!('layerName' in this.config)) {
      missingConfigOptions.push('layerName');
    }
    if (!('compatibleRuntimes' in this.config)) {
      missingConfigOptions.push('compatibleRuntimes');
    }
    if (!('license' in this.config)) {
      missingConfigOptions.push('license');
    }
    if (missingConfigOptions.length > 0) {
      throw new ConfigurationError(
        'Missing project configuration parameter(s): ' + missingConfigOptions
      );
    }
  }

  /**
   * Publishes current lambda layer zip bundle to AWS Lambda.
   * @param version New version to be released.
   * @param revision Git commit SHA to be published.
   */
  public async publish(version: string, revision: string): Promise<any> {
    this.checkProjectConfig();

    logger.debug('Fetching artifact list...');
    const packageFiles = await this.getArtifactsForRevision(revision, {
      includeNames:
        this.config.includeNames === undefined
          ? undefined
          : new RegExp(this.config.includeNames),
    });

    if (packageFiles.length == 0) {
      reportError('Cannot publish AWS Lambda Layer: no packages found');
      return undefined;
    } else if (packageFiles.length > 1) {
      reportError(
        'Cannot publish AWS Lambda Layer: ' +
          'multiple packages with matching patterns were found. You may want ' +
          'to include or modify the includeNames parameter in the project config'
      );
      return undefined;
    }

    const artifactBuffer = fs.readFileSync(
      await this.artifactProvider.downloadArtifact(packageFiles[0])
    );

    /** Creates symlinks to the new version file, and updates previous ones if needed. */
    const createVersionSymlinks = (
      directory: string,
      versionFilepath: string
    ): void => {
      const latestVersionPath = path.posix.join(directory, 'latest.json');
      if (fs.existsSync(latestVersionPath)) {
        const previousVersion = fs
          .readlinkSync(latestVersionPath)
          .split('.json')[0];
        createSymlinks(versionFilepath, version, previousVersion);
      } else {
        // When no previous versions are found, just create symlinks.
        createSymlinks(versionFilepath, version);
      }
    };

    logger.debug('Fetching AWS regions...');
    const awsRegions = extractRegionNames(await getRegionsFromAws());

    /** Publishes new AWS Lambda layers for every runtime. */
    const publishRuntimes = async (directory: string): Promise<void> => {
      await this.config.compatibleRuntimes.forEach(
        async (runtime: CompatibleRuntime) => {
          const layerManager = new AwsLambdaLayerManager(
            runtime,
            this.config.layerName,
            this.config.license,
            artifactBuffer,
            awsRegions
          );

          // TODO: handle when something in the AWS SDK breaks
          const publishedLayers = await layerManager.publishAllRegions();

          // If no layers have been created, don't do extra work updating files.
          if (publishedLayers.length == 0) {
            logger.info(`${runtime.name}: no layers published.`);
            return;
          } else {
            logger.info(
              `${runtime.name}: ${publishedLayers.length} layers published.`
            );
          }

          // Base directory for the layer files of the current runtime.
          const RUNTIME_BASE_DIR = path.posix.join(
            directory,
            this.AWS_REGISTRY_DIR,
            runtime.name
          );
          if (!fs.existsSync(RUNTIME_BASE_DIR)) {
            logger.warn(
              `Directory structure for ${runtime.name} is missing, skipping file creation.`
            );
            return;
          }

          const regionsVersions = publishedLayers.map(layer => {
            return {
              region: layer.region,
              version: layer.version.toString(),
            };
          });

          // Common data specific to all the layers in the current runtime.
          const runtimeData = {
            canonical: layerManager.getCanonicalName(),
            sdk_version: version,
            account_number: getAccountFromArn(publishedLayers[0].arn),
            layer_name: this.config.layerName,
            regions: regionsVersions,
          };

          const baseFilepath = path.posix.join(
            RUNTIME_BASE_DIR,
            this.BASE_FILENAME
          );
          const newVersionFilepath = path.posix.join(
            RUNTIME_BASE_DIR,
            `${version}.json`
          );

          if (!fs.existsSync(baseFilepath)) {
            logger.warn(`The ${runtime.name} base file is missing.`);
            fs.writeFileSync(newVersionFilepath, JSON.stringify(runtimeData));
          } else {
            const baseData = JSON.parse(
              fs.readFileSync(baseFilepath).toString()
            );
            fs.writeFileSync(
              newVersionFilepath,
              JSON.stringify({ ...baseData, ...runtimeData })
            );
          }

          createVersionSymlinks(RUNTIME_BASE_DIR, newVersionFilepath);
          logger.info(`${runtime.name}: created files and updated symlinks.`);
        }
      );
    };

    await withTempDir(
      async directory => {
        // TODO: git clone
        await publishRuntimes(directory);
        // TODO: git commit
        // TODO: git push
      },
      true,
      'craft-release-awslambdalayer-'
    );
  }
}
