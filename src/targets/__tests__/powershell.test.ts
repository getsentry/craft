import { NoneArtifactProvider } from '../../artifact_providers/none';
import { ConfigurationError } from '../../utils/errors';
import { PowerShellTarget } from '../powershell';

jest.mock('fs');

/** Returns a new PowerShellTarget test instance. */
function getPwshTarget(): PowerShellTarget {
  return new PowerShellTarget(
    {
      name: 'powershell',
      module: 'moduleName',
      repository: 'repositoryName',
    },
    new NoneArtifactProvider()
  );
}

function setPwshEnvironmentVariables() {
  process.env.POWERSHELL_API_KEY = 'test access key';
}

describe('pwsh environment variables', () => {
  const oldEnvVariables = process.env;

  beforeEach(() => {
    jest.resetModules(); // Clear the cache.
    process.env = { ...oldEnvVariables }; // Restore environment
  });

  afterAll(() => {
    process.env = { ...oldEnvVariables }; // Restore environment
  });

  function deleteTargetOptionsFromEnvironment() {
    if ('POWERSHELL_API_KEY' in process.env) {
      delete process.env.POWERSHELL_API_KEY;
    }
  }

  test('errors on missing environment variables', () => {
    deleteTargetOptionsFromEnvironment();
    try {
      getPwshTarget();
    } catch (e) {
      expect(e instanceof ConfigurationError).toBe(true);
    }
  });

  test('success on environment variables', () => {
    deleteTargetOptionsFromEnvironment();
    setPwshEnvironmentVariables();
    // AwsLambdaTarget needs the environment variables to initialize.
    getPwshTarget();
  });
});

describe('config', () => {
  function clearConfig(target: PowerShellTarget): void {
    target.psConfig.apiKey = '';
    target.psConfig.repository = '';
    target.psConfig.module = '';
  }

  test('fails with missing config parameters', async () => {
    const target = getPwshTarget();
    clearConfig(target);
    try {
      await target.publish('', '');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      expect(error.message).toBe(
        'Missing project configuration parameter(s): apiKey,repository,module');
    }
  });
});

describe('publish', () => {
  beforeAll(() => {
    setPwshEnvironmentVariables();
  });

  const noArtifactsForRevision = jest.fn().mockImplementation(function () {
    return [];
  });

  test('error on missing artifact', async () => {
    const target = getPwshTarget();
    target.getArtifactsForRevision = noArtifactsForRevision.bind(
      PowerShellTarget
    );
    // `publish` should report an error. When it's not dry run, the error is
    // thrown; when it's on dry run, the error is logged and `undefined` is
    // returned. Thus, both alternatives have been considered.
    try {
      const noPackageFound = await target.publish('version', 'revision');
      expect(noPackageFound).toBe(undefined);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toMatch(/there are no matching artifacts/);
    }
  });

  const twoArtifactsForRevision = jest.fn().mockImplementation(function () {
    return ['file1', 'file2'];
  });

  test('error on having too many artifacts', async () => {
    const target = getPwshTarget();
    target.getArtifactsForRevision = twoArtifactsForRevision.bind(
      PowerShellTarget
    );
    // `publish` should report an error. When it's not dry run, the error is
    // thrown; when it's on dry run, the error is logged and `undefined` is
    // returned. Thus, both alternatives have been considered.
    try {
      const multiplePackagesFound = await target.publish(
        'version',
        'revision'
      );
      expect(multiplePackagesFound).toBe(undefined);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toMatch(/found multiple matching artifacts/);
    }
  });
});
