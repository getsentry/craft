import { getLatestTag } from '../git';
import * as loggerModule from '../../logger';

describe('getLatestTag', () => {
  it('returns latest tag in the repo by calling `git describe`', async () => {
    const git = {
      raw: jest.fn().mockResolvedValue('1.0.0'),
    } as any;

    const latestTag = await getLatestTag(git);
    expect(latestTag).toBe('1.0.0');

    expect(git.raw).toHaveBeenCalledWith('describe', '--tags', '--abbrev=0');
  });

  it('logs a helpful error message if the git call throws', async () => {
    loggerModule.setLevel(loggerModule.LogLevel.Debug);
    const loggerErrorSpy = jest
      .spyOn(loggerModule.logger, 'error')
      .mockImplementation(() => {
        // just to avoid spamming the test output
      });

    const error = new Error('Nothing to describe');
    const git = {
      raw: jest.fn().mockRejectedValue(error),
    } as any;

    try {
      await getLatestTag(git);
    } catch (e) {
      expect(e).toBe(error);
    }

    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "If you're releasing for the first time, check if your repo contains any tags"
      )
    );
  });
});
