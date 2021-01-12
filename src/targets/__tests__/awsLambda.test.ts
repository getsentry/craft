import { NoneArtifactProvider } from '../../artifact_providers/none';
import { ConfigurationError } from '../../utils/errors';
import {
  AwsLambdaTarget,
  getAwsLayerName,
  defaultLayerName,
} from '../awsLambda';

jest.mock('fs');

/** Returns a new AwsLambdaTarget test instance. */
function getAwsLambdaTarget(): AwsLambdaTarget {
  return new AwsLambdaTarget(
    {
      ['testKey']: 'testValue',
    },
    new NoneArtifactProvider()
  );
}

function setAwsEnvironmentVariables() {
  process.env.AWS_ACCESS_KEY_ID = 'test aws access key';
  process.env.AWS_SECRET_ACCESS_KEY = 'test aws secret access key';
}

describe('get layer name environment variable', () => {
  test('default environment variable', () => {
    if ('AWS_LAYER_NAME' in process.env) {
      delete process.env.AWS_LAYER_NAME;
    }
    expect(getAwsLayerName()).toBe(defaultLayerName);
  });

  test('custom environment variable', () => {
    const customEnvName = 'test-env-layer-name';
    process.env.AWS_LAYER_NAME = customEnvName;
    expect(getAwsLayerName()).toBe(customEnvName);
  });
});

describe('get aws config environment variables', () => {
  const oldEnvVariables = process.env;

  beforeEach(() => {
    jest.resetModules(); // Clear the cache.
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

describe('publish', () => {
  beforeAll(() => {
    setAwsEnvironmentVariables();
  });

  const noArtifactsForRevision = jest.fn().mockImplementation(function() {
    return [];
  });

  test('error on missing zip file', async () => {
    const awsTarget = getAwsLambdaTarget();
    awsTarget.getArtifactsForRevision = noArtifactsForRevision.bind(
      AwsLambdaTarget
    );
    // `publish` should report an error. When it's not dry run, the error is
    // thrown; when it's on dry run, the error is logged and `undefined` is
    // returned. Thus, both alternatives have been considered.
    try {
      const noPackageFound = await awsTarget.publish('version', 'revision');
      expect(noPackageFound).toBe(undefined);
    } catch (error) {
      expect(error instanceof Error).toBe(true);
    }
  });

  const twoArtifactsForRevision = jest.fn().mockImplementation(function() {
    return ['file1', 'file2'];
  });

  test('error on having too many files', async () => {
    const awsTarget = getAwsLambdaTarget();
    awsTarget.getArtifactsForRevision = twoArtifactsForRevision.bind(
      AwsLambdaTarget
    );
    // `publish` should report an error. When it's not dry run, the error is
    // thrown; when it's on dry run, the error is logged and `undefined` is
    // returned. Thus, both alternatives have been considered.
    try {
      const tooManyPackagesFound = await awsTarget.publish(
        'version',
        'revision'
      );
      expect(tooManyPackagesFound).toBe(undefined);
    } catch (error) {
      expect(error instanceof Error).toBe(true);
    }
  });

  const singleArtifactsForRevision = jest
    .fn()
    .mockImplementation(function(input: string) {
      return [input];
    });

  const downloadArtifactMock = jest
    .fn()
    .mockImplementation(function(input: string) {
      return input;
    });

  const publishAwsLayerMock = jest.fn().mockImplementation(function() {
    return {
      Version: 1,
      LayerVersionArn: 'layer:version:arn:test',
    };
  });
  const publishAwsLayerMockUndefinedVersion = jest
    .fn()
    .mockImplementation(function() {
      return {
        Version: undefined,
        LayerVersionArn: 'layer:version:arn:test',
      };
    });

  const addLayerPermissionsMock = jest.fn().mockImplementation(function() {
    // Do nothing
  });

  test('success on publishing', async () => {
    const awsTarget = getAwsLambdaTarget();
    awsTarget.getArtifactsForRevision = singleArtifactsForRevision.bind(
      AwsLambdaTarget
    );
    awsTarget.artifactProvider.downloadArtifact = downloadArtifactMock.bind(
      awsTarget
    );
    awsTarget.publishAwsLayer = publishAwsLayerMock.bind(AwsLambdaTarget);
    awsTarget.addAwsLayerPermissions = addLayerPermissionsMock.bind(
      AwsLambdaTarget
    );
    awsTarget.publish('', '');
  });

  test('error on layer version', async () => {
    try {
      const awsTarget = getAwsLambdaTarget();
      awsTarget.getArtifactsForRevision = singleArtifactsForRevision.bind(
        AwsLambdaTarget
      );
      awsTarget.artifactProvider.downloadArtifact = downloadArtifactMock.bind(
        awsTarget
      );
      awsTarget.publishAwsLayer = publishAwsLayerMockUndefinedVersion.bind(
        AwsLambdaTarget
      );
      const publishedLayerVersion = awsTarget.publish('', '');
      // `publish` should report an error. When it's not dry run, the error is
      // thrown; when it's on dry run, the error is logged and `undefined` is
      // returned. Thus, both alternatives have been considered.
      expect(publishedLayerVersion).toBe(undefined);
    } catch (error) {
      expect(error instanceof Error).toBe(true);
    }
  });
});
