import { spawnProcess } from '../../utils/system';
import { runPreReleaseCommand } from '../release';

jest.mock('../../utils/system');

describe('runPreReleaseCommand', () => {
  const newVersion = '2.3.4';
  const mockedSpawnProcess = spawnProcess as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('runs with default command', async () => {
    expect.assertions(1);

    await runPreReleaseCommand(newVersion);

    expect(mockedSpawnProcess).toBeCalledWith(
      '/bin/bash',
      ['scripts/bump-version.sh', '', newVersion],
      {
        env: {
          ...process.env,
          CRAFT_NEW_VERSION: newVersion,
          CRAFT_OLD_VERSION: '',
        },
      }
    );
  });

  test('runs with custom command', async () => {
    expect.assertions(1);

    await runPreReleaseCommand(
      newVersion,
      'python ./increase_version.py "argument 1"'
    );

    expect(mockedSpawnProcess).toBeCalledWith(
      'python',
      ['./increase_version.py', 'argument 1', '', newVersion],
      {
        env: {
          ...process.env,
          CRAFT_NEW_VERSION: newVersion,
          CRAFT_OLD_VERSION: '',
        },
      }
    );
  });
});
