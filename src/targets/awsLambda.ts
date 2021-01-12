import * as fs from 'fs';
import { logger as loggerRaw } from '../logger';
import { TargetConfig } from '../schemas/project_config';
import { BaseTarget } from './base';
import { BaseArtifactProvider } from '../artifact_providers/base';
import { ConfigurationError, reportError } from '../utils/errors';
import { AWSError } from 'aws-sdk';
import * as Lambda from 'aws-sdk/clients/lambda';
import { PromiseResult } from 'aws-sdk/lib/request';

const logger = loggerRaw.withScope(`[aws-lambda]`);

/**
 * RegExp for the AWS Lambda package.
 * The pattern matches the following structure:
 * `sentry-node-serverless-{version}.zip`.
 */
const DEFAULT_AWS_LAMBDA_DIST_REGEX = /^sentry-node-serverless-\d+(\.\d+)*\.zip$/;

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

const compatibleRuntimes = ['nodejs10.x', 'nodejs12.x'];

/** Config options for the "aws-lambda" target. */
interface AwsLambdaTargetOptions extends TargetConfig {
  /** AWS access key ID, set as AWS_ACCESS_KEY_ID. */
  awsAccessKeyId: string;
  /** AWS secret access key, set as `AWS_SECRET_ACCESS_KEY`. */
  awsSecretAccessKey: string;
}

/**
 * The default layer name is used when no `AWS_LAYER_NAME`
 * environment variable is found.
 */
export const defaultLayerName = 'SentryNodeServerlessSDK';

/**
 * Extracts the AWS Lambda layer name from the environment variables. If no
 * environment variable is found, the default name is used.
 */
export function getAwsLayerName(): string {
  if (!process.env.AWS_LAYER_NAME) {
    return defaultLayerName;
  } else {
    return process.env.AWS_LAYER_NAME;
  }
}

/**
 * Target responsible for uploading files to AWS Lambda.
 */
export class AwsLambdaTarget extends BaseTarget {
  /** Target name */
  public readonly name: string = 'aws-lambda';
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
    AwsLambdaTarget.layerName = getAwsLayerName();
  }

  /**
   * Extracts AWS Lambda target options from the environment.
   */
  protected getAwsLambdaConfig(): AwsLambdaTargetOptions {
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      throw new ConfigurationError(
        `Cannot perform AWS Lambda release: missing credentials.
        Please use AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables.`
      );
    }
    return {
      awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID,
      awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    };
  }

  /**
   * Publishes current lambda layer zip bundle to AWS Lambda.
   * @param _version New version to be released.
   * @param revision Git commit SHA to be published.
   */
  public async publish(_version: string, revision: string): Promise<any> {
    logger.debug('Fetching artifact list...');
    const packageFiles = await this.getArtifactsForRevision(revision, {
      includeNames: DEFAULT_AWS_LAMBDA_DIST_REGEX,
    });

    if (packageFiles.length == 0) {
      reportError('Cannot release to AWS Lambda: no packages found');
      return undefined;
    } else if (packageFiles.length > 1) {
      reportError(`Cannot release to AWS Lambda:
      multiple packages with matching patterns were found.`);
      return undefined;
    }

    const artifactBuffer = fs.readFileSync(
      await this.artifactProvider.downloadArtifact(packageFiles[0])
    );

    const publishRegionToLambda = async (currentRegion: string) => {
      const lambda = new Lambda({ region: currentRegion });

      const publishedLayer = await this.publishAwsLayer(lambda, {
        Content: {
          ZipFile: artifactBuffer,
        },
        LayerName: AwsLambdaTarget.layerName,
        CompatibleRuntimes: compatibleRuntimes,
        LicenseInfo: 'MIT',
      });

      if (publishedLayer.Version === undefined) {
        reportError(`Error while publishing AWS Layer to ${currentRegion}`);
        return;
      }

      await this.addAwsLayerPermissions(lambda, {
        LayerName: AwsLambdaTarget.layerName,
        VersionNumber: publishedLayer.Version,
        StatementId: 'public',
        Action: 'lambda:GetLayerVersion',
        Principal: '*',
      });

      logger.info(`Published layer in ${currentRegion}:
        ${publishedLayer.LayerVersionArn}`);
    };

    await Promise.all(awsAllRegions.map(publishRegionToLambda));
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
    return lambda
      .addLayerVersionPermission(layerPermissionData)
      .promise();
  }
}
