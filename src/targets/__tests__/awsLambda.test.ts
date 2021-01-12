import { NoneArtifactProvider } from '../../artifact_providers/none';
import { ConfigurationError } from '../../utils/errors';
import { AwsLambdaLayerTarget } from '../awsLambdaLayer';

jest.mock('fs');

/** Returns a new AwsLambdaLayerTarget test instance. */
function getAwsLambdaTarget(): AwsLambdaLayerTarget {
  return new AwsLambdaLayerTarget(
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

  const twoArtifactsForRevision = jest.fn().mockImplementation(function() {
    return ['file1', 'file2'];
  });

  test('error on having too many files', async () => {
    const awsTarget = getAwsLambdaTarget();
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
      AwsLambdaLayerTarget
    );
    awsTarget.artifactProvider.downloadArtifact = downloadArtifactMock.bind(
      awsTarget
    );
    awsTarget.publishAwsLayer = publishAwsLayerMock.bind(AwsLambdaLayerTarget);
    awsTarget.addAwsLayerPermissions = addLayerPermissionsMock.bind(
      AwsLambdaLayerTarget
    );
    await awsTarget.publish('', '');
    expect(singleArtifactsForRevision).toBeCalledWith('', { includeNames: undefined });
    expect(downloadArtifactMock).toBeCalledWith('');
  });

  test('error on layer version', async () => {
    try {
      const awsTarget = getAwsLambdaTarget();
      awsTarget.getArtifactsForRevision = singleArtifactsForRevision.bind(
        AwsLambdaLayerTarget
      );
      awsTarget.artifactProvider.downloadArtifact = downloadArtifactMock.bind(
        awsTarget
      );
      awsTarget.publishAwsLayer = publishAwsLayerMockUndefinedVersion.bind(
        AwsLambdaLayerTarget
      );
      const publishedLayerVersion = await awsTarget.publish('', '');
      // `publish` should report an error. When it's not dry run, the error is
      // thrown; when it's on dry run, the error is logged and `undefined` is
      // returned. Thus, both alternatives have been considered.
      expect(publishedLayerVersion).toBe(undefined);
    } catch (error) {
      expect(error instanceof Error).toBe(true);
    } finally {
      expect(singleArtifactsForRevision).toBeCalledWith('', { includeNames: undefined });
      expect(downloadArtifactMock).toBeCalledWith('');
    }
  });
});
