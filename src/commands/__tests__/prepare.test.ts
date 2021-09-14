import { join as pathJoin } from 'path';
import { spawnProcess } from '../../utils/system';
import { runPreReleaseCommand } from '../prepare';

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
