import { any } from 'async';
import {
  BaseArtifactProvider,
  RemoteArtifact,
} from '../../artifact_providers/base';
import { ConfigurationError } from '../../utils/errors';
import { AwsLambdaTarget } from '../awsLambda';

class TestArtifactProvider extends BaseArtifactProvider {
  protected doDownloadArtifact(
    _artifact: RemoteArtifact,
    _downloadDirectory: string
  ): Promise<string> {
    throw new Error('Method not implemented.');
  }

  protected doListArtifactsForRevision(
    _revision: string
  ): Promise<RemoteArtifact[]> {
    throw new Error('Method not implemented.');
  }
}

/** Returns a new AwsLambdaTarget test instance. */
function getAwsLambdaTarget(): AwsLambdaTarget {
  return new AwsLambdaTarget(
    any,
    new TestArtifactProvider({
      repoName: 'testName',
      repoOwner: 'testRepo',
      ['testKey']: 'testValue',
    })
  );
}

function setAwsEnvironmentVariables() {
  process.env.AWS_ACCESS_KEY_ID = 'test aws access key';
  process.env.AWS_SECRET_ACCESS_KEY = 'test aws secret access key';
}

describe('get environment variables', () => {
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
