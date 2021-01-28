import { DescribeRegionsCommandOutput, EC2 } from '@aws-sdk/client-ec2';
import {
  AddLayerVersionPermissionRequest,
  Lambda,
  PublishLayerVersionCommandOutput,
  PublishLayerVersionRequest,
} from '@aws-sdk/client-lambda';
import { logger as loggerRaw } from '../logger';

const logger = loggerRaw.withScope('[aws-lambda-layer]');

/** Prefix of the canonical name. */
const RUNTIME_CANONICAL_PREFIX = 'aws-layer:';

/**
 * Info for a runtime.
 * Example:
 *  name: 'node'
 *  runtimeVersions: ['nodejs10.x', 'nodejs12.x']
 */
interface CompatibleRuntime {
  name: string;
  runtimeVersions: string[];
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
  /** Regions to publish the layer to. */
  private awsRegions: string[] = [];
  /** Name of the layer to be published. */
  private layerName: string;
  /** License of the layer. */
  private license: string;
  /** Buffer of the ZIP file to use in the AWS Lambda layer. */
  private artifactBuffer: Buffer;

  public constructor(
    runtime: CompatibleRuntime,
    layerName: string,
    license: string,
    artifactBuffer: Buffer,
    awsRegions: string[]
  ) {
    this.runtime = runtime;
    this.layerName = layerName;
    this.license = license;
    this.artifactBuffer = artifactBuffer;
    this.awsRegions = awsRegions;
  }

  /**
   * Publishes an AWS Lambda layer to the given region.
   * @param region The AWS region to publish the layer to.
   * @param verboseInfo if true, logs to info the published layer ARN.
   *  Default is true.
   * @returns Information about the published layer: region, arn and version.
   */
  public async publishLayerToRegion(
    region: string,
    verboseInfo = true
  ): Promise<PublishedLayer> {
    const lambda = new Lambda({ region: region });
    const publishedLayer = await publishAwsLayer(lambda, {
      Content: {
        ZipFile: this.artifactBuffer,
      },
      LayerName: this.layerName,
      CompatibleRuntimes: this.runtime.runtimeVersions,
      LicenseInfo: this.license,
    });

    await addAwsLayerPermissions(lambda, {
      LayerName: this.layerName,
      VersionNumber: publishedLayer.Version,
      StatementId: 'public',
      Action: 'lambda:GetLayerVersion',
      Principal: '*',
    });

    if (verboseInfo) {
      logger.info(`Published layer in ${region}:
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
   *
   * @returns Array of the published layers.
   */
  public async publishAllRegions(): Promise<PublishedLayer[]> {
    return await Promise.all(
      this.awsRegions.map(region => {
        return this.publishLayerToRegion(region);
      })
    );
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

/**
 * Requests all regions that are enabled for the current account (or all
 * regions) to AWS. For more information, see
 * https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/EC2.html#describeRegions-property
 */
export async function getRegionsFromAws(): Promise<
  DescribeRegionsCommandOutput
> {
  logger.debug('Fetching AWS regions...');
  const ec2 = new EC2({ region: 'us-east-2' });
  try {
    return await ec2.describeRegions({});
  } catch (error) {
    throw new Error('AWS error fetching regions.');
  }
}

/**
 * Extracts the region name from each region, when available.
 * @param awsRegions data containing the regions returned by AWS.
 */
export function extractRegionNames(
  awsRegions: DescribeRegionsCommandOutput
): string[] {
  const regionNames: string[] = [];
  awsRegions.Regions?.map(currentRegion => {
    if (currentRegion.RegionName !== undefined) {
      regionNames.push(currentRegion.RegionName);
    }
  });
  return regionNames;
}

/** Substring used to separate the different ARN parts. */
const ARN_SEPARATOR = ':';
/** Index (0-based) of the account number in the ARN. */
const ARN_ACCOUNT_INDEX = 4;

/**
 * Extracts the AWS account number from the given ARN and returns it
 * (as a string).
 * @param arn The ARN of the account.
 */
export function getAccountFromArn(arn: string): string {
  return arn.split(ARN_SEPARATOR)[ARN_ACCOUNT_INDEX];
}

/**
 * Publishes the layer to AWS Lambda with the given layer data.
 * It must contain the buffer for the ZIP archive and the layer name.
 * Each time you publish with the same layer name, a new version is created.
 * @param lambda The lambda service object.
 * @param layerData Details of the layer to be created.
 */
function publishAwsLayer(
  lambda: Lambda,
  layerData: PublishLayerVersionRequest
): Promise<PublishLayerVersionCommandOutput> {
  return lambda.publishLayerVersion(layerData);
}

/**
 * Adds to a layer usage permissions to other accounts.
 * @param lambda The lambda service object.
 * @param layerPermissionData Details of the layer and permissions to be set.
 */
function addAwsLayerPermissions(
  lambda: Lambda,
  layerPermissionData: AddLayerVersionPermissionRequest
): Promise<any> {
  return lambda.addLayerVersionPermission(layerPermissionData);
}
