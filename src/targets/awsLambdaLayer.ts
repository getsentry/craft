import * as fs from 'fs';
import { logger as loggerRaw } from '../logger';
import { TargetConfig } from '../schemas/project_config';
import { BaseTarget } from './base';
import { BaseArtifactProvider } from '../artifact_providers/base';
import { ConfigurationError, reportError } from '../utils/errors';
import { getRegionsFromAws, AwsLambdaLayerManager, extractRegionNames } from '../utils/awsLambdaLayerManager';

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
  public async publish(_version: string, revision: string): Promise<any> {
    this.checkProjectConfig();

    logger.debug('Fetching AWS regions...');
    const awsRegions = extractRegionNames(
      await getRegionsFromAws()
    );

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

    await this.config.compatibleRuntimes.forEach(
      async (runtime: { name: string; runtimeVersions: string[] }) => {
        const layerManager = new AwsLambdaLayerManager(
          runtime,
          this.config.layerName,
          this.config.license,
          artifactBuffer,
          awsRegions
        );

        layerManager;

        const publishedLayers = await layerManager.publishAllRegions();
        publishedLayers.map(publishedLayer => console.log(publishedLayer));

        // TODO: if the file structure exists: create files, add symlinks,
        // etc. if necessary
      }
    );

    // TODO: commit and push

  }
}
