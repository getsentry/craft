import { vi, type Mock, type MockInstance, type Mocked, type MockedFunction } from 'vitest';
import { NoneArtifactProvider } from '../../artifact_providers/none';
import { ConfigurationError } from '../../utils/errors';
import { AwsLambdaLayerTarget } from '../awsLambdaLayer';

vi.mock('fs');

/** Returns a new AwsLambdaLayerTarget test instance. */
function getAwsLambdaTarget(): AwsLambdaLayerTarget {
  return new AwsLambdaLayerTarget(
    {
      name: 'aws-lambda-layer',
      ['testKey']: 'testValue',
    },
    new NoneArtifactProvider()
  );
}

function setAwsEnvironmentVariables() {
  process.env.AWS_ACCESS_KEY_ID = 'test aws access key';
  process.env.AWS_SECRET_ACCESS_KEY = 'test aws secret access key';
  process.env.GITHUB_TOKEN = 'test github token';
  process.env.GITHUB_API_TOKEN = 'test github api token';
}

function setTestingProjectConfig(awsTarget: AwsLambdaLayerTarget) {
  awsTarget.config.layerName = 'testLayerName';
  awsTarget.config.compatibleRuntimes = [
    {
      name: 'runtimeTestName',
      versions: ['nodejs10.x', 'nodejs12.x'],
    },
  ];
  awsTarget.config.license = 'MIT';
}

describe('get aws config environment variables', () => {
  const oldEnvVariables = process.env;

  beforeEach(() => {
    vi.resetModules(); // Clear the cache.
    process.env = { ...oldEnvVariables }; // Restore environment
  });

  afterAll(() => {
    process.env = { ...oldEnvVariables }; // Restore environment
  });

  function deleteTargetOptionsFromEnvironment() {
    if ('AWS_ACCESS_KEY_ID' in process.env) {
      delete process.env.AWS_ACCESS_KEY_ID;
    }
    if ('AWS_SECRET_ACCESES_KEY' in process.env) {
      delete process.env.AWS_SECRET_ACCESES_KEY;
    }
  }

  test('errors on missing environment variables', () => {
    deleteTargetOptionsFromEnvironment();
    try {
      getAwsLambdaTarget();
    } catch (e) {
      expect(e instanceof ConfigurationError).toBe(true);
    }
  });

  test('success on environment variables', () => {
    deleteTargetOptionsFromEnvironment();
    setAwsEnvironmentVariables();
    // AwsLambdaTarget needs the environment variables to initialize.
    getAwsLambdaTarget();
  });
});

describe('project config parameters', () => {
  beforeAll(() => {
    setAwsEnvironmentVariables();
  });

  function clearConfig(awsTarget: AwsLambdaLayerTarget): void {
    delete awsTarget.config.layerName;
    delete awsTarget.config.compatibleRuntimes;
    delete awsTarget.config.license;
  }

  test('missing config parameters', async () => {
    const awsTarget = getAwsLambdaTarget();
    clearConfig(awsTarget);
    try {
      await awsTarget.publish('', '');
    } catch (error) {
      expect(error instanceof ConfigurationError).toBe(true);
      expect(
        /Missing project configuration parameter/.test(error.message)
      ).toBe(true);
    }
  });

  test('correct config', async () => {
    const awsTarget = getAwsLambdaTarget();
    setTestingProjectConfig(awsTarget);
    const failingTestErrorMsg = 'failing mock test';
    const getArtifactsFailingMock = vi.fn().mockImplementation(() => {
      throw new Error(failingTestErrorMsg);
    });
    try {
      // In order to isolate and only test the project config options, the next
      // function to be executed (`getArtifactsForRevision`) has been mocked to
      // throw an error and avoid the whole `publish` to be executed. So, if
      // the error in the mocked function is thrown, the project config test
      // was successful; on the other hand, if it's not thrown, the test fails.
      awsTarget.getArtifactsForRevision = getArtifactsFailingMock.bind(
        AwsLambdaLayerTarget
      );
      await awsTarget.publish('', ''); // Should break the mocked function.
      fail('Should not reach here');
    } catch (error) {
      expect(new RegExp(failingTestErrorMsg).test(error.message)).toBe(true);
    }
  });
});

describe('layer name templating', () => {
  beforeAll(() => {
    setAwsEnvironmentVariables();
  });

  test('layer name without template variables', () => {
    const awsTarget = getAwsLambdaTarget();
    awsTarget.config.layerName = 'SentryNodeServerlessSDK';
    const resolved = awsTarget.resolveLayerName('10.2.3');
    expect(resolved).toBe('SentryNodeServerlessSDK');
  });

  test('layer name with major version variable', () => {
    const awsTarget = getAwsLambdaTarget();
    awsTarget.config.layerName = 'SentryNodeServerlessSDKv{{{major}}}';
    const resolved = awsTarget.resolveLayerName('10.2.3');
    expect(resolved).toBe('SentryNodeServerlessSDKv10');
  });

  test('layer name with multiple version variables', () => {
    const awsTarget = getAwsLambdaTarget();
    awsTarget.config.layerName = 'SentrySDKv{{{major}}}-{{{minor}}}-{{{patch}}}';
    const resolved = awsTarget.resolveLayerName('10.2.3');
    expect(resolved).toBe('SentrySDKv10-2-3');
  });

  test('layer name with full version variable', () => {
    const awsTarget = getAwsLambdaTarget();
    awsTarget.config.layerName = 'SentrySDK-{{{version}}}';
    const resolved = awsTarget.resolveLayerName('10.2.3');
    expect(resolved).toBe('SentrySDK-10.2.3');
  });

  test('layer name with prerelease version', () => {
    const awsTarget = getAwsLambdaTarget();
    awsTarget.config.layerName = 'SentrySDKv{{{major}}}';
    const resolved = awsTarget.resolveLayerName('10.2.3-alpha.1');
    expect(resolved).toBe('SentrySDKv10');
  });
});

describe('publish', () => {
  beforeAll(() => {
    setAwsEnvironmentVariables();
  });

  const noArtifactsForRevision = vi.fn().mockImplementation(function () {
    return [];
  });

  test('error on missing artifact', async () => {
    const awsTarget = getAwsLambdaTarget();
    setTestingProjectConfig(awsTarget);
    awsTarget.getArtifactsForRevision = noArtifactsForRevision.bind(
      AwsLambdaLayerTarget
    );
    // `publish` should report an error. When it's not dry run, the error is
    // thrown; when it's on dry run, the error is logged and `undefined` is
    // returned. Thus, both alternatives have been considered.
    try {
      const noPackageFound = await awsTarget.publish('version', 'revision');
      expect(noPackageFound).toBe(undefined);
    } catch (error) {
      expect(error instanceof Error).toBe(true);
      const noPackagePattern = /no packages found/;
      expect(noPackagePattern.test(error.message)).toBe(true);
    }
  });

  const twoArtifactsForRevision = vi.fn().mockImplementation(function () {
    return ['file1', 'file2'];
  });

  test('error on having too many artifacts', async () => {
    const awsTarget = getAwsLambdaTarget();
    setTestingProjectConfig(awsTarget);
    awsTarget.getArtifactsForRevision = twoArtifactsForRevision.bind(
      AwsLambdaLayerTarget
    );
    // `publish` should report an error. When it's not dry run, the error is
    // thrown; when it's on dry run, the error is logged and `undefined` is
    // returned. Thus, both alternatives have been considered.
    try {
      const multiplePackagesFound = await awsTarget.publish(
        'version',
        'revision'
      );
      expect(multiplePackagesFound).toBe(undefined);
    } catch (error) {
      expect(error instanceof Error).toBe(true);
      const multiplePackagesPattern = /multiple packages/;
      expect(multiplePackagesPattern.test(error.message)).toBe(true);
    }
  });
});
