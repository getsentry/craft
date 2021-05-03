import { DescribeRegionsCommandOutput } from "@aws-sdk/client-ec2";
import * as awsManager from "../awsLambdaLayerManager";

const CANONICAL_SEPARATOR = ":";

const COMPATIBLE_RUNTIME_DATA = {
  name: "test runtime",
  versions: ["test version 1", "test version 2"],
};
const AWS_TEST_REGIONS = ["test aws region 1", "test aws region 2"];

/** The default region used to fetch all available AWS regions. */
const DEFAULT_REGION = "us-east-2";

function getTestAwsLambdaLayerManager(): awsManager.AwsLambdaLayerManager {
  return new awsManager.AwsLambdaLayerManager(
    COMPATIBLE_RUNTIME_DATA,
    "test layer name",
    "test license",
    Buffer.alloc(0),
    AWS_TEST_REGIONS
  );
}

describe("canonical", () => {
  test("get canonical name", () => {
    const manager = getTestAwsLambdaLayerManager();
    const canonicalSuffix = manager
      .getCanonicalName()
      .split(CANONICAL_SEPARATOR)[1];
    expect(canonicalSuffix).toBe("test runtime");
  });
});

describe("utils", () => {
  test("account from arn", () => {
    const testAccount = "ACCOUNT_NUMBER";
    const testArn =
      "arn:aws:lambda:region:" + testAccount + ":layer:layerName:version";
    expect(awsManager.getAccountFromArn(testArn)).toBe(testAccount);
  });

  test("get regions", async () => {
    const regions = await awsManager.getRegionsFromAws();
    expect(regions).toBe(DEFAULT_REGION);
  });

  test("extract region names", () => {
    const testRegionName1 = "eu-north-1";
    const testRegionName2 = "ap-south-1";

    const regionsToExtract = {
      Regions: [
        {
          Endpoint: "ec2.eu-north-1.amazonaws.com",
          RegionName: testRegionName1,
          OptInStatus: "opt-in-not-required",
        },
        {
          Endpoint: "ec2.ap-south-1.amazonaws.com",
          RegionName: testRegionName2,
          OptInStatus: "opt-in-not-required",
        },
      ],
    };
    const extractedRegionNames = [testRegionName1, testRegionName2];

    expect(
      awsManager.extractRegionNames(
        regionsToExtract as DescribeRegionsCommandOutput
      )
    ).toStrictEqual(extractedRegionNames);
  });
});

describe("layer publishing", () => {
  test("publish to single region", async () => {
    const regionTest = "region-test";
    const manager = getTestAwsLambdaLayerManager();
    const publishedLayer = await manager.publishLayerToRegion(regionTest);
    expect(publishedLayer.region).toStrictEqual(regionTest);
  });

  test("publish to all regions", async () => {
    const manager = getTestAwsLambdaLayerManager();
    const pubishedLayers = await manager.publishToAllRegions();
    const publishedRegions = pubishedLayers.map((layer) => layer.region);
    expect(publishedRegions).toStrictEqual(AWS_TEST_REGIONS);
  });
});
