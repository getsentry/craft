import * as fs from 'fs';
import * as path from 'path';

import { logger as loggerRaw } from '../logger';
import { TargetConfig } from '../schemas/project_config';
import { BaseTarget } from './base';
import { BaseArtifactProvider } from '../artifact_providers/base';
import { ConfigurationError, reportError } from '../utils/errors';
import {
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
   * @param _version New version to be released.
   * @param revision Git commit SHA to be published.
   */
  public async publish(version: string, revision: string): Promise<any> {
    this.checkProjectConfig();

    logger.debug('Fetching AWS regions...');
    const awsRegions = extractRegionNames(await getRegionsFromAws());

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

    /**
     * Base directory containing the runtime directories.
     * Each runtime directory contains files regarding the created layers using
     * that runtime.
     */
    const AWS_REGISTRY_DIRECTORY = 'aws-lambda-layers';

    // TODO: docs
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

    // The base file contains info fields that all runtimes should override.
    const BASE_FILENAME = 'base.json';

    const publishRuntimes = async (directory: string): Promise<void> => {
      await this.config.compatibleRuntimes.forEach(
        async (runtime: { name: string; runtimeVersions: string[] }) => {
          const layerManager = new AwsLambdaLayerManager(
            runtime,
            this.config.layerName,
            this.config.license,
            artifactBuffer,
            awsRegions
          );

          const publishedLayers = await layerManager.publishAllRegions();

          // If no layers have been created, there's no need to do extra work
          // in updating the files
          if (publishedLayers.length == 0) {
            return;
          }
          const runtimeBaseDir = path.posix.join(
            directory,
            AWS_REGISTRY_DIRECTORY,
            runtime.name
          );
          if (!fs.existsSync(runtimeBaseDir)) {
            console.log(runtimeBaseDir);
            logger.warn('TODO: file directory doesnt exist, skipping...');
            return;
          }

          const regionsVersions = publishedLayers.map(layer => {
            return {
              region: layer.region,
              version: layer.version.toString(),
            };
          });

          // Common information specific to all the layers in the current runtime.
          const runtimeData = {
            canonical: layerManager.getCanonicalName(),
            sdk_version: version,
            account_number: getAccountFromArn(publishedLayers[0].arn),
            layer_name: this.config.layerName,
            regions: regionsVersions,
          };

          // The base file contains fields that must exist in all the
          // version files, such as links to docs or repositories.
          const baseFilepath = path.posix.join(runtimeBaseDir, BASE_FILENAME);
          const newVersionFilepath = path.posix.join(
            runtimeBaseDir,
            `${version}.json`
          );

          if (!fs.existsSync(baseFilepath)) {
            console.log(baseFilepath);
            logger.warn('TODO: base file doesnt exist');
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

          createVersionSymlinks(runtimeBaseDir, newVersionFilepath);
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
