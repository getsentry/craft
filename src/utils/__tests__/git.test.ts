import { vi } from 'vitest';
import { getLatestTag, isRepoDirty } from '../git';
import * as loggerModule from '../../logger';
import type { StatusResult } from 'simple-git';

describe('getLatestTag', () => {
  it('returns latest tag in the repo by calling `git describe`', async () => {
    const git = {
      raw: vi.fn().mockResolvedValue('1.0.0'),
    } as any;

    const latestTag = await getLatestTag(git);
    expect(latestTag).toBe('1.0.0');

    expect(git.raw).toHaveBeenCalledWith('describe', '--tags', '--abbrev=0');
  });

  it('moves on with empty string when no tags are found', async () => {
    loggerModule.setLevel(loggerModule.LogLevel.Debug);

    const error = new Error('fatal: No names found');
    const git = {
      raw: vi.fn().mockRejectedValue(error),
    } as any;

    const latestTag = await getLatestTag(git);
    expect(latestTag).toBe('');
  });
});

describe('isRepoDirty', () => {
  const createCleanStatus = (): StatusResult => ({
    not_added: [],
    conflicted: [],
    created: [],
    deleted: [],
    ignored: [],
    modified: [],
    renamed: [],
    staged: [],
    files: [],
    ahead: 0,
    behind: 0,
    current: 'main',
    tracking: 'origin/main',
    detached: false,
    isClean: () => true,
  });

  it('returns false for clean repository', () => {
    const status = createCleanStatus();
    expect(isRepoDirty(status)).toBe(false);
  });

  it('returns true when there are modified files', () => {
    const status = createCleanStatus();
    status.modified = ['file.txt'];
    expect(isRepoDirty(status)).toBe(true);
  });

  it('returns true when there are created files', () => {
    const status = createCleanStatus();
    status.created = ['newfile.txt'];
    expect(isRepoDirty(status)).toBe(true);
  });

  it('returns true when there are deleted files', () => {
    const status = createCleanStatus();
    status.deleted = ['removed.txt'];
    expect(isRepoDirty(status)).toBe(true);
  });

  it('returns true when there are staged files', () => {
    const status = createCleanStatus();
    status.staged = ['staged.txt'];
    expect(isRepoDirty(status)).toBe(true);
  });

  it('returns true when there are renamed files', () => {
    const status = createCleanStatus();
    status.renamed = [{ from: 'old.txt', to: 'new.txt' }];
    expect(isRepoDirty(status)).toBe(true);
  });

  it('returns true when there are conflicted files', () => {
    const status = createCleanStatus();
    status.conflicted = ['conflict.txt'];
    expect(isRepoDirty(status)).toBe(true);
  });
});
