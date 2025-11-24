import { join as pathJoin } from 'path';
import { spawnProcess } from '../../utils/system';
import { runPreReleaseCommand, checkVersionOrPart } from '../prepare';

jest.mock('../../utils/system');

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
      { v: 'major', e: 'Version part is not supported yet' },
      { v: 'minor', e: 'Version part is not supported yet' },
      { v: 'patch', e: 'Version part is not supported yet' },
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
