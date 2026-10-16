import { vi } from 'vitest';
import * as awsManager from '../awsLambdaLayerManager';

const {
  mockState,
  mockLambdaConstructor,
  mockPublishLayerVersion,
  mockAddLayerVersionPermission,
  mockLoggerError,
  mockCaptureException,
} = vi.hoisted(() => ({
  mockState: { failRegion: undefined as string | undefined },
  mockLambdaConstructor: vi.fn(),
  mockPublishLayerVersion: vi.fn(),
  mockAddLayerVersionPermission: vi.fn().mockResolvedValue({}),
  mockLoggerError: vi.fn(),
  mockCaptureException: vi.fn(),
}));

vi.mock('../../logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: (...args: unknown[]) => mockLoggerError(...args),
  },
}));

vi.mock('@sentry/node', () => ({
  captureException: (...args: unknown[]) => mockCaptureException(...args),
}));

const SUCCESSFUL_LAYER = {
  LayerVersionArn: 'arn:aws:lambda:test-region:123456789:layer:test-layer:1',
  Version: 1,
};

vi.mock('@aws-sdk/client-lambda', () => ({
  Lambda: vi.fn().mockImplementation(function (
    this: any,
    config: { region: string; maxAttempts: number },
  ) {
    mockLambdaConstructor(config);
    this.publishLayerVersion = async (...args: unknown[]) => {
      mockPublishLayerVersion(...args);
      if (mockState.failRegion && config.region === mockState.failRegion) {
        throw new Error('AccessDeniedException');
      }
      return SUCCESSFUL_LAYER;
    };
    this.addLayerVersionPermission = mockAddLayerVersionPermission;
  }),
  Runtime: {},
  Architecture: {},
}));

const CANONICAL_SEPARATOR = ':';

const COMPATIBLE_RUNTIME_DATA = {
  name: 'test runtime',
  versions: ['test version 1', 'test version 2'],
};
const COMPATIBLE_ARCHITECTURES = ['x86_64', 'arm64'];
const AWS_TEST_REGIONS = ['test aws region 1', 'test aws region 2'];

function getTestAwsLambdaLayerManager(
  architectures?: string[],
): awsManager.AwsLambdaLayerManager {
  return new awsManager.AwsLambdaLayerManager(
    COMPATIBLE_RUNTIME_DATA,
    'test layer name',
    'test license',
    Buffer.alloc(0),
    AWS_TEST_REGIONS,
    '0.0.0',
    architectures,
  );
}

describe('canonical', () => {
  test('get canonical name', () => {
    const manager = getTestAwsLambdaLayerManager();
    const canonicalSuffix = manager
      .getCanonicalName()
      .split(CANONICAL_SEPARATOR)[1];
    expect(canonicalSuffix).toBe('test runtime');
  });
});

describe('utils', () => {
  test('account from arn', () => {
    const testAccount = 'ACCOUNT_NUMBER';
    const testArn =
      'arn:aws:lambda:region:' + testAccount + ':layer:layerName:version';
    expect(awsManager.getAccountFromArn(testArn)).toBe(testAccount);
  });
});

describe('layer publishing', () => {
  beforeEach(() => {
    mockState.failRegion = undefined;
    mockLambdaConstructor.mockClear();
    mockPublishLayerVersion.mockClear();
    mockAddLayerVersionPermission.mockClear();
    mockLoggerError.mockClear();
    mockCaptureException.mockClear();
  });

  test('publish to single region', async () => {
    const regionTest = 'region-test';
    const manager = getTestAwsLambdaLayerManager();
    const publishedLayer = await manager.publishLayerToRegion(regionTest);
    expect(publishedLayer.region).toStrictEqual(regionTest);
    expect(mockLambdaConstructor).toHaveBeenCalledWith({
      region: regionTest,
      maxAttempts: 3,
    });
    expect(mockPublishLayerVersion).toHaveBeenCalledWith(
      expect.not.objectContaining({
        CompatibleArchitectures: expect.anything(),
      }),
    );
  });

  test('publish with compatible architectures', async () => {
    const manager = getTestAwsLambdaLayerManager(COMPATIBLE_ARCHITECTURES);
    await manager.publishLayerToRegion('region-test');
    expect(mockPublishLayerVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        CompatibleRuntimes: COMPATIBLE_RUNTIME_DATA.versions,
        CompatibleArchitectures: COMPATIBLE_ARCHITECTURES,
      }),
    );
  });

  test('publish to all regions', async () => {
    const manager = getTestAwsLambdaLayerManager();
    const publishedLayers = await manager.publishToAllRegions();
    expect(publishedLayers.map(layer => layer.region)).toStrictEqual(
      AWS_TEST_REGIONS,
    );
  });

  test('failed region does not block other regions', async () => {
    mockState.failRegion = AWS_TEST_REGIONS[1];
    const manager = getTestAwsLambdaLayerManager();
    const publishedLayers = await manager.publishToAllRegions();

    expect(publishedLayers.map(layer => layer.region)).toStrictEqual([
      AWS_TEST_REGIONS[0],
    ]);
    expect(mockLoggerError).toHaveBeenCalled();
    expect(mockCaptureException).toHaveBeenCalled();
  });
});
