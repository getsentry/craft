import { spawnProcess } from '../../utils/system';
import { NoneArtifactProvider } from '../../artifact_providers/none';
import { ConfigurationError } from '../../utils/errors';
import { PowerShellTarget } from '../powershell';

jest.mock('fs');
jest.mock('../../utils/system');

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
  const mockedSpawnProcess = spawnProcess as jest.Mock;
  const spawnOptions = { enableInDryRunMode: true, showStdout: true }

  beforeEach(() => {
    setPwshEnvironmentVariables();
    jest.clearAllMocks();
  });


  test('error on missing artifact', async () => {
    const target = getPwshTarget();
    target.getArtifactsForRevision = jest.fn()
      .mockImplementation(() => []).bind(PowerShellTarget);

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

  test('error on having too many artifacts', async () => {
    const target = getPwshTarget();
    target.getArtifactsForRevision = jest.fn()
      .mockImplementation(() => ['file1', 'file2']).bind(PowerShellTarget);

    // `publish` should report an error. When it's not dry run, the error is
    // thrown; when it's on dry run, the error is logged and `undefined` is
    // returned. Thus, both alternatives have been considered.
    try {
      await target.publish('1.0', 'sha');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toMatch(/found multiple matching artifacts/);
    }
  });

  test('prints pwsh info', async () => {
    const target = getPwshTarget();
    try {
      await target.publish('1.0', 'sha');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toMatch(/there are no matching artifact/);
    }
    expect(mockedSpawnProcess).toBeCalledWith('pwsh', ['--version'], {}, spawnOptions);
    expect(mockedSpawnProcess).toBeCalledWith('pwsh',
      [
        '-Command',
        `$ErrorActionPreference = 'Stop'

      $info = Get-Command -Name Publish-Module
      "Module name: $($info.ModuleName)"
      "Module version: $($info.Module.Version)"
      "Module path: $($info.Module.Path)"
    `
      ], {}, spawnOptions);
  });

  test('publish-module runs with expected args', async () => {
    const target = getPwshTarget();
    await target.publishModule('/path/to/module');
    expect(mockedSpawnProcess).toBeCalledWith('pwsh',
      [
        '-Command',
        `$ErrorActionPreference = 'Stop'

        Publish-Module  -Path '/path/to/module' \`
                        -Repository 'repositoryName' \`
                        -NuGetApiKey 'test access key' \`
                        -WhatIf:$false
      `
      ], {}, spawnOptions);
  });
});
