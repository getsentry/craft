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

  it('moves on with empty string when no tags are found', async () => {
    loggerModule.setLevel(loggerModule.LogLevel.Debug);

    const error = new Error('Nothing to describe');
    const git = {
      raw: jest.fn().mockRejectedValue(error),
    } as any;

    const latestTag = await getLatestTag(git);
    expect(latestTag).toBe('');
  });
});
