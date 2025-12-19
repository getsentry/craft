import { join as pathJoin } from 'path';
import { spawnProcess } from '../../utils/system';
import { runPreReleaseCommand, checkVersionOrPart, uploadPreReleaseTargets } from '../prepare';
import * as config from '../../config';
import { BaseTarget } from '../../targets/base';

jest.mock('../../utils/system');
jest.mock('../../config');
jest.mock('../../targets');

describe('runPreReleaseCommand', () => {
  const oldVersion = '2.3.3';
  const newVersion = '2.3.4';
  const mockedSpawnProcess = spawnProcess as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('runs with default command', async () => {
    expect.assertions(1);

    await runPreReleaseCommand(oldVersion, newVersion);

    expect(mockedSpawnProcess).toBeCalledWith(
      '/bin/bash',
      [pathJoin('scripts', 'bump-version.sh'), oldVersion, newVersion],
      {
        env: {
          ...process.env,
          CRAFT_NEW_VERSION: newVersion,
          CRAFT_OLD_VERSION: oldVersion,
        },
      }
    );
  });

  test('runs with custom command', async () => {
    expect.assertions(1);

    await runPreReleaseCommand(
      oldVersion,
      newVersion,
      'python ./increase_version.py "argument 1"'
    );

    expect(mockedSpawnProcess).toBeCalledWith(
      'python',
      ['./increase_version.py', 'argument 1', oldVersion, newVersion],
      {
        env: {
          ...process.env,
          CRAFT_NEW_VERSION: newVersion,
          CRAFT_OLD_VERSION: oldVersion,
        },
      }
    );
  });
});

describe('checkVersionOrPart', () => {
  test('return true for valid version', () => {
    const validVersions = ['2.3.3', '0.0.1'];
    for (const v of validVersions) {
      expect(
        checkVersionOrPart(
          {
            newVersion: v,
          },
          null
        )
      ).toBe(true);
    }
  });

  test('return true for auto version', () => {
    expect(
      checkVersionOrPart(
        {
          newVersion: 'auto',
        },
        null
      )
    ).toBe(true);
  });

  test('return true for version bump types', () => {
    const bumpTypes = ['major', 'minor', 'patch'];
    for (const bumpType of bumpTypes) {
      expect(
        checkVersionOrPart(
          {
            newVersion: bumpType,
          },
          null
        )
      ).toBe(true);
    }
  });

  test('throw an error for invalid version', () => {
    const invalidVersions = [
      {
        v: 'invalid-2.3.3',
        e: 'Invalid version or version part specified: "invalid-2.3.3"',
      },
      {
        v: 'v2.3.3',
        e:
          'Invalid version or version part specified: "v2.3.3". Removing the "v" prefix will likely fix the issue',
      },
    ];
    for (const t of invalidVersions) {
      const fn = () => {
        checkVersionOrPart(
          {
            newVersion: t.v,
          },
          null
        );
      };
      expect(fn).toThrow(t.e);
    }
  });
});

describe('uploadPreReleaseTargets', () => {
  const newVersion = '2.3.4';
  const revision = 'abc123def456';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('skips when no preReleaseTargets configured', async () => {
    const mockedGetConfiguration = jest.spyOn(config, 'getConfiguration').mockReturnValue({
      preReleaseTargets: undefined,
    } as any);

    await uploadPreReleaseTargets(newVersion, revision);

    expect(mockedGetConfiguration).toHaveBeenCalled();
    mockedGetConfiguration.mockRestore();
  });

  test('skips when preReleaseTargets is empty array', async () => {
    const mockedGetConfiguration = jest.spyOn(config, 'getConfiguration').mockReturnValue({
      preReleaseTargets: [],
    } as any);

    await uploadPreReleaseTargets(newVersion, revision);

    expect(mockedGetConfiguration).toHaveBeenCalled();
    mockedGetConfiguration.mockRestore();
  });

  test('uploads to configured pre-release targets', async () => {
    const mockPublish = jest.fn();
    const mockTarget = {
      id: 'test-target',
      publish: mockPublish,
    } as any as BaseTarget;

    const mockedGetConfiguration = jest.spyOn(config, 'getConfiguration').mockReturnValue({
      preReleaseTargets: [{ name: 'test-target' }],
    } as any);

    const mockedGetArtifactProvider = jest.spyOn(config, 'getArtifactProviderFromConfig').mockResolvedValue({} as any);
    const mockedGetGlobalGitHubConfig = jest.spyOn(config, 'getGlobalGitHubConfig').mockResolvedValue({} as any);
    const mockedExpandWorkspaceTargets = jest.spyOn(config, 'expandWorkspaceTargets').mockResolvedValue([{ name: 'test-target' }] as any);

    // Mock the target constructor
    const { getTargetByName } = require('../../targets');
    getTargetByName.mockReturnValue(jest.fn(() => mockTarget));

    await uploadPreReleaseTargets(newVersion, revision);

    expect(mockedGetConfiguration).toHaveBeenCalled();
    expect(mockedGetArtifactProvider).toHaveBeenCalled();
    expect(mockedGetGlobalGitHubConfig).toHaveBeenCalled();
    expect(mockedExpandWorkspaceTargets).toHaveBeenCalled();
    expect(mockPublish).toHaveBeenCalledWith(newVersion, revision);

    mockedGetConfiguration.mockRestore();
    mockedGetArtifactProvider.mockRestore();
    mockedGetGlobalGitHubConfig.mockRestore();
    mockedExpandWorkspaceTargets.mockRestore();
  });
});
