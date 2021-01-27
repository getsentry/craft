import { DescribeRegionsCommandOutput, EC2 } from '@aws-sdk/client-ec2';
import { AddLayerVersionPermissionRequest, Lambda, PublishLayerVersionCommandOutput, PublishLayerVersionRequest } from '@aws-sdk/client-lambda';
import { logger as loggerRaw } from '../logger';


const logger = loggerRaw.withScope('[aws-lambda-layer]');

const RUNTIME_CANONICAL_PREFIX = 'awslayer:';
const ARN_SEPARATOR = ':';
const ARN_ACCOUNT_INDEX = 4;

interface CompatibleRuntime {
  name: string;
  runtimeVersions: string[];
}

interface PublishedLayer {
  region: string;
  arn: string;
  version: number;
}

export class AwsLambdaLayerManager {
  private runtime: CompatibleRuntime;
  private awsRegions: string[] = [];
  private layerName: string;
  private license: string;
  private artifactBuffer: Buffer;

  public constructor(
    runtime: CompatibleRuntime,
    layerName: string,
    license: string,
    artifactBuffer: Buffer,
    awsRegions: string[],
  ) {
    this.runtime = runtime;
    this.layerName = layerName;
    this.license = license;
    this.artifactBuffer = artifactBuffer;
    this.awsRegions = awsRegions;
  }

  public async publishLayerToRegion(region: string, verboseInfo = false): Promise<PublishedLayer> {
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

  public async publishAllRegions(): Promise<PublishedLayer[]> {
    return await Promise.all(
      this.awsRegions.map((region) => {
        return this.publishLayerToRegion(region);
      })
    );
  }

  public getCanonicalName(): string {
    return RUNTIME_CANONICAL_PREFIX + this.runtime.name;
  }

}

/**
 * Requests all regions that are enabled for the current account (or all
 * regions) to AWS. For more information, see
 * https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/EC2.html#describeRegions-property
 */
export async function getRegionsFromAws(): Promise<DescribeRegionsCommandOutput> {
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
export function extractRegionNames(awsRegions: DescribeRegionsCommandOutput): string[] {
  const regionNames: string[] = [];
  awsRegions.Regions?.map(currentRegion => {
    if (currentRegion.RegionName !== undefined) {
      regionNames.push(currentRegion.RegionName);
    }
  });
  return regionNames;
}

export function getAccountNumberFromArn(arn: string): number {
  return parseInt(arn.split(ARN_SEPARATOR)[ARN_ACCOUNT_INDEX]);
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
