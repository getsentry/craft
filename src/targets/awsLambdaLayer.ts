import * as fs from 'fs';
import { logger as loggerRaw } from '../logger';
import { TargetConfig } from '../schemas/project_config';
import { BaseTarget } from './base';
import { BaseArtifactProvider } from '../artifact_providers/base';
import { ConfigurationError, reportError } from '../utils/errors';
import { AWSError } from 'aws-sdk';
import * as Lambda from 'aws-sdk/clients/lambda';
import { PromiseResult } from 'aws-sdk/lib/request';

const logger = loggerRaw.withScope(`[aws-lambda-layer]`);

const awsAllRegions = [
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'us-west-2',
  'ap-south-1',
  'ap-southeast-1',
  'ap-southeast-2',
  'ap-northeast-1',
  'ap-northeast-2',
  'ca-central-1',
  'eu-central-1',
  'eu-west-1',
  'eu-west-2',
  'eu-west-3',
  'sa-east-1',
];

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
  /** Name of the layer to be published */
  static layerName: string;

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

    const publishRegion = async (currentRegion: string) => {
      const lambda = new Lambda({ region: currentRegion });

      const publishedLayer = await this.publishAwsLayer(lambda, {
        Content: {
          ZipFile: artifactBuffer,
        },
        LayerName: this.config.layerName,
        CompatibleRuntimes: this.config.compatibleRuntimes,
        LicenseInfo: 'MIT',
      });

      if (publishedLayer.Version === undefined) {
        reportError(`Error while publishing AWS Layer to ${currentRegion}`);
        return;
      }

      await this.addAwsLayerPermissions(lambda, {
        LayerName: this.config.layerName,
        VersionNumber: publishedLayer.Version,
        StatementId: 'public',
        Action: 'lambda:GetLayerVersion',
        Principal: '*',
      });

      logger.info(`Published layer in ${currentRegion}:
        ${publishedLayer.LayerVersionArn}`);
    };

    await Promise.all(awsAllRegions.map(publishRegion));
  }

  /**
   * Publishes the layer to AWS Lambda with the given layer data.
   * It must contain the buffer for the ZIP archive and the layer name.
   * Each time you publish with the same layer name, a new version is created.
   * @param lambda The lambda service object.
   * @param layerData Details of the layer to be created.
   */
  public publishAwsLayer(
    lambda: Lambda,
    layerData: Lambda.PublishLayerVersionRequest
  ): Promise<PromiseResult<Lambda.PublishLayerVersionResponse, AWSError>> {
    return lambda.publishLayerVersion(layerData).promise();
  }

  /**
   * Adds to a layer usage permissions to other accounts.
   * @param lambda The lambda service object.
   * @param layerPermissionData Details of the layer and permissions to be set.
   */
  public addAwsLayerPermissions(
    lambda: Lambda,
    layerPermissionData: Lambda.AddLayerVersionPermissionRequest
  ): Promise<
    PromiseResult<Lambda.AddLayerVersionPermissionResponse, AWSError>
  > {
    return lambda.addLayerVersionPermission(layerPermissionData).promise();
  }
}
