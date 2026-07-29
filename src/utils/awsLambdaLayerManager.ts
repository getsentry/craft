import { XMLParser } from 'fast-xml-parser';
import aws4 from 'aws4';
import fetch from 'node-fetch';
import { Architecture, Lambda, Runtime } from '@aws-sdk/client-lambda';
import { captureException } from '@sentry/node';
import { logger } from '../logger';

/** Prefix of the canonical name. */
const RUNTIME_CANONICAL_PREFIX = 'aws-layer:';
/** Substring used to separate the different ARN parts. */
const ARN_SEPARATOR = ':';
/** Index (0-based) of the account number in the ARN. */
const ARN_ACCOUNT_INDEX = 4;
/** Total AWS SDK attempts per operation, including the initial request. */
const AWS_MAX_ATTEMPTS = 3;

/**
 * Info for a runtime.
 * Example:
 *  name: 'node'
 *  runtimeVersions: ['nodejs10.x', 'nodejs12.x']
 */
export interface CompatibleRuntime {
  name: string;
  versions: string[];
}

/** Subset of data of a published layer in AWS Lambda. */
interface PublishedLayer {
  region: string;
  arn: string;
  version: number;
}

/**
 * Responsible for publishing layers in AWS Lambda.
 */
export class AwsLambdaLayerManager {
  /** Compatible runtimes with the new layer.  */
  private runtime: CompatibleRuntime;
  /** Compatible architectures with the new layer. */
  private compatibleArchitectures?: string[];
  /** Regions to publish the layer to. */
  private awsRegions: string[] = [];
  /** Name of the layer to be published. */
  private layerName: string;
  /** License of the layer. */
  private license: string;
  /** Buffer of the ZIP file to use in the AWS Lambda layer. */
  private artifactBuffer: Buffer;
  /** Controls if published layers are logged. */
  public verboseInfo = true;
  /** Version of the SDK. */
  private sdkVersion: string;

  public constructor(
    runtime: CompatibleRuntime,
    layerName: string,
    license: string,
    artifactBuffer: Buffer,
    awsRegions: string[],
    sdkVersion: string,
    compatibleArchitectures?: string[],
  ) {
    this.runtime = runtime;
    this.layerName = layerName;
    this.license = license;
    this.artifactBuffer = artifactBuffer;
    this.awsRegions = awsRegions;
    this.sdkVersion = sdkVersion;
    this.compatibleArchitectures = compatibleArchitectures;
  }

  /**
   * Publishes an AWS Lambda layer to the given region.
   * @param region The AWS region to publish the layer to.
   * @returns Information about the published layer: region, arn and version.
   */
  public async publishLayerToRegion(region: string): Promise<PublishedLayer> {
    logger.debug(`Publishing layer to ${region}...`);
    // Let the AWS SDK retry transient failures with exponential backoff.
    const lambda = new Lambda({
      region,
      maxAttempts: AWS_MAX_ATTEMPTS,
    });
    const publishedLayer = await lambda.publishLayerVersion({
      Content: {
        ZipFile: this.artifactBuffer,
      },
      LayerName: this.layerName,
      CompatibleRuntimes: this.runtime.versions as Runtime[],
      ...(this.compatibleArchitectures?.length
        ? {
          CompatibleArchitectures: this
            .compatibleArchitectures as Architecture[],
        }
        : {}),
      LicenseInfo: this.license,
      Description: `Sentry AWS Serverless SDK v${this.sdkVersion}`,
    });
    await lambda.addLayerVersionPermission({
      LayerName: this.layerName,
      VersionNumber: publishedLayer.Version,
      StatementId: 'public',
      Action: 'lambda:GetLayerVersion',
      Principal: '*',
    });

    if (this.verboseInfo) {
      logger.info(`Published layer in ${region} for ${this.runtime.name}:
        ${publishedLayer.LayerVersionArn}`);
    }

    return {
      region: region,
      arn: publishedLayer.LayerVersionArn || '',
      version: publishedLayer.Version || -1,
    };
  }

  /**
   * Publishes new AWS Lambda layers to all the regions.
   * Failed regions are reported, but do not block the release.
   * @returns Array of the successfully published layers.
   */
  public async publishToAllRegions(): Promise<PublishedLayer[]> {
    type RegionResult =
      | { region: string; layer: PublishedLayer }
      | { region: string; error: Error };

    const results: RegionResult[] = await Promise.all(
      this.awsRegions.map(async (region): Promise<RegionResult> => {
        try {
          const layer = await this.publishLayerToRegion(region);
          return { region, layer: layer };
        } catch (error) {
          return {
            region,
            error: error instanceof Error ? error : new Error(String(error)),
          };
        }
      }),
    );

    const failed = results.filter(
      (result): result is { region: string; error: Error } => 'error' in result,
    );
    if (failed.length) {
      const summary =
        `Layer published with ${failed.length} failed region(s) for ` +
        `${this.runtime.name}: ${failed.map(f => f.region).join(', ')}`;
      logger.error(summary);
      for (const { region, error } of failed) {
        logger.error(`  ${region}: ${error.message}`);
      }
      captureException(new Error(summary), {
        extra: {
          runtime: this.runtime.name,
          sdkVersion: this.sdkVersion,
          failedRegions: failed.map(f => ({
            region: f.region,
            message: f.error.message,
          })),
        },
      });
    }

    return results
      .filter(
        (result): result is { region: string; layer: PublishedLayer } =>
          'layer' in result,
      )
      .map(result => result.layer);
  }

  /**
   * Returns the canonical name of the current lambda layer.
   * The canonical name is composed by the canonical prefix and the runtime
   * name.
   */
  public getCanonicalName(): string {
    return RUNTIME_CANONICAL_PREFIX + this.runtime.name;
  }
}

interface Region {
  regionName: string;
  regionEndpoint: string;
}

/**
 * Requests all regions that are enabled for the current account (or all
 * regions) to AWS. For more information, see
 * https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/EC2.html#describeRegions-property
 */
export async function getRegionsFromAws(): Promise<string[]> {
  logger.debug('Fetching AWS regions...');
  const { hostname, path, headers } = aws4.sign({
    service: 'ec2',
    region: 'us-east-2',
    path: '/?Action=DescribeRegions&Version=2013-10-15',
  });

  const url = `https://${hostname}${path}`;
  const response = await fetch(url, {
    headers: headers as Record<string, string>,
  });
  if (!response.ok) {
    throw new Error(
      `Unexpected HTTP response from ${url}: ${response.status} (${response.statusText})`,
    );
  }
  const data = await response.text();
  return new XMLParser()
    .parse(data)
    .DescribeRegionsResponse.regionInfo.item.map(
      (region: Region) => region.regionName,
    )
    .filter(Boolean);
}

/**
 * Extracts the AWS account number from the given ARN and returns it
 * (as a string).
 * @param arn The ARN of the account.
 */
export function getAccountFromArn(arn: string): string {
  return arn.split(ARN_SEPARATOR)[ARN_ACCOUNT_INDEX];
}
