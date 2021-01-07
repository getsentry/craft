import { logger as loggerRaw } from '../logger';
import { TargetConfig } from '../schemas/project_config';
import { BaseTarget } from './base';
import {
  BaseArtifactProvider,
} from '../artifact_providers/base';
import { ConfigurationError, reportError } from '../utils/errors';
import Lambda = require('aws-sdk/clients/lambda');
import fs = require('fs');

const logger = loggerRaw.withScope(`[aws-lambda]`);

/**
 * RegExp for the AWS Lambda package.
 * The pattern matches the following structure:
 * `sentry-node-serverless-{version}.zip`.
 */
const DEFAULT_AWS_LAMBDA_DIST_REGEX = /sentry-node-serverless-\d+(\.\d+)*\.zip$/

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

const layerName = 'SentryNodeServerlessSdk';
const compatibleRuntimes = ['nodejs10.x', 'nodejs12.x'];

/** Config options for the "aws-lambda" target. */
interface AwsLambdaTargetOptions extends TargetConfig {
  /** AWS access key ID */
  awsAccessKeyId: string;
  /** AWS secret access key */
  awsSecretAccessKey: string;
}

/**
 * Target responsible for uploading files to AWS Lambda.
 */
export class AwsLambdaTarget extends BaseTarget {
  /** Target name */
  public readonly name: string = 'aws-lambda';
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
        `Cannot perform AWS Lambda release: missing credentials.
        Please use AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables.`
      )
    }
    return {
      awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID,
      awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    }
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
    })

    if (packageFiles.length == 0) {
      reportError('Cannot release to AWS Lambda: no packages found');
      return undefined;
    } else if(packageFiles.length > 1) {
      reportError(`Cannot release to AWS Lambda:
        multiple packages with matching patterns were found.`);
      return undefined;
    }

    const artifactBuffer = fs.readFileSync(
      await this.artifactProvider.downloadArtifact(packageFiles[0])
    );

    for (let i = 0; i < awsAllRegions.length; i++) {
      const currentRegion = awsAllRegions[i];
      const lambda = new Lambda({ region: currentRegion });
      const publishedLayer = await lambda
        .publishLayerVersion({
          Content: {
            ZipFile: artifactBuffer,
          },
          LayerName: layerName,
          CompatibleRuntimes: compatibleRuntimes,
          LicenseInfo: 'MIT',
        })
        .promise();

      if (publishedLayer.Version === undefined) {
        publishedLayer.Version = -1;
      }

      await lambda
        .addLayerVersionPermission({
          LayerName: layerName,
          VersionNumber: publishedLayer.Version,
          StatementId: 'public',
          Action: 'lambda:GetLayerVersion',
          Principal: '*',
        })
        .promise();

      logger.info(`Published layer in ${currentRegion}:
        ${publishedLayer.LayerVersionArn}`);
    }
  }

}