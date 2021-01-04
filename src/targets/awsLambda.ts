import { logger as loggerRaw } from '../logger';
import { TargetConfig } from '../schemas/project_config';
import { BaseTarget } from './base';
import {
  BaseArtifactProvider,
} from '../artifact_providers/base';
import { ConfigurationError } from '../utils/errors';

const logger = loggerRaw.withScope(`[aws-lambda]`);

/** Config options for the "aws-lambda" target. */
interface AwsLambdaTargetOptions extends TargetConfig {
  /** AWS access key ID */
  awsAccessKeyId: string;
  /** AWS secret access key */
  awsSecretAccessKey: string;
}

/**
 * Target responsible for uploading files to AWS Lambda
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
   * @param version
   * @param revision
   */
  public async publish(version: string, revision: string): Promise<any> {
    logger.debug(`version: ${version}`);
    logger.debug(`revision: ${revision}`);
    // Package pattern: `sentry-node-serverless-{version}.zip`
    throw new Error('[aws-lambda] Method not implemented.');
  }

}
