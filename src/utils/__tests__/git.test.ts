import { vi } from 'vitest';
import { getLatestTag, isRepoDirty, findReleaseBranches } from '../git';
import * as loggerModule from '../../logger';
import type { StatusResult } from 'simple-git';

describe('getLatestTag', () => {
  it('returns latest tag in the repo by calling `git describe`', async () => {
    const git = {
      raw: vi.fn().mockResolvedValue('1.0.0'),
    } as any;

    const latestTag = await getLatestTag(git);
    expect(latestTag).toBe('1.0.0');

    expect(git.raw).toHaveBeenCalledWith(['describe', '--tags', '--abbrev=0']);
  });

  it('scopes `git describe` to the tag prefix via --match when provided', async () => {
    const git = {
      raw: vi.fn().mockResolvedValue('cli@1.2.3'),
    } as any;

    const latestTag = await getLatestTag(git, 'cli@');
    expect(latestTag).toBe('cli@1.2.3');

    expect(git.raw).toHaveBeenCalledWith([
      'describe',
      '--tags',
      '--abbrev=0',
      '--match',
      'cli@*',
    ]);
  });

  it('does not add --match for an empty prefix', async () => {
    const git = {
      raw: vi.fn().mockResolvedValue('1.0.0'),
    } as any;

    await getLatestTag(git, '');

    expect(git.raw).toHaveBeenCalledWith(['describe', '--tags', '--abbrev=0']);
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

  it('returns empty string when prefix matches no tags', async () => {
    const error = new Error('fatal: No names found');
    const git = {
      raw: vi.fn().mockRejectedValue(error),
    } as any;

    const latestTag = await getLatestTag(git, 'mcp@');
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

describe('findReleaseBranches', () => {
  function createMockGit(branchOutput: string, fetchError?: Error) {
    return {
      fetch: fetchError
        ? vi.fn().mockRejectedValue(fetchError)
        : vi.fn().mockResolvedValue(undefined),
      raw: vi.fn().mockResolvedValue(branchOutput),
    } as any;
  }

  it('returns exact matches for branches with matching prefix', async () => {
    const git = createMockGit(
      '  origin/release/1.2.0\n  origin/release/1.2.1\n  origin/release/1.2.2\n',
    );

    const result = await findReleaseBranches(git, 'release');

    expect(result.exactMatches).toEqual([
      'origin/release/1.2.2',
      'origin/release/1.2.1',
      'origin/release/1.2.0',
    ]);
    expect(result.fuzzyMatches).toEqual([]);
  });

  it('returns fuzzy matches for branches with similar prefix (edit distance <= 3)', async () => {
    const git = createMockGit(
      '  origin/releases/1.0.0\n  origin/relaese/2.0.0\n',
    );

    const result = await findReleaseBranches(git, 'release');

    expect(result.exactMatches).toEqual([]);
    // "releases" has distance 1, "relaese" has distance 2
    expect(result.fuzzyMatches).toEqual([
      'origin/relaese/2.0.0',
      'origin/releases/1.0.0',
    ]);
  });

  it('returns both exact and fuzzy matches together', async () => {
    const git = createMockGit(
      '  origin/release/1.0.0\n  origin/releases/1.0.0\n  origin/release/2.0.0\n',
    );

    const result = await findReleaseBranches(git, 'release');

    expect(result.exactMatches).toEqual([
      'origin/release/2.0.0',
      'origin/release/1.0.0',
    ]);
    expect(result.fuzzyMatches).toEqual(['origin/releases/1.0.0']);
  });

  it('returns empty results when no branches match', async () => {
    const git = createMockGit(
      '  origin/main\n  origin/develop\n  origin/feature/foo\n',
    );

    const result = await findReleaseBranches(git, 'release');

    expect(result.exactMatches).toEqual([]);
    expect(result.fuzzyMatches).toEqual([]);
  });

  it('filters out HEAD pointer entries', async () => {
    const git = createMockGit(
      '  origin/HEAD -> origin/main\n  origin/release/1.0.0\n',
    );

    const result = await findReleaseBranches(git, 'release');

    expect(result.exactMatches).toEqual(['origin/release/1.0.0']);
    expect(result.fuzzyMatches).toEqual([]);
  });

  it('respects the limit parameter', async () => {
    const git = createMockGit(
      '  origin/release/1.0.0\n  origin/release/1.1.0\n  origin/release/1.2.0\n  origin/release/1.3.0\n  origin/release/1.4.0\n',
    );

    const result = await findReleaseBranches(git, 'release', 2);

    expect(result.exactMatches).toHaveLength(2);
    // Most recent (last in git output) come first
    expect(result.exactMatches).toEqual([
      'origin/release/1.4.0',
      'origin/release/1.3.0',
    ]);
  });

  it('fetches from remote before listing branches', async () => {
    const git = createMockGit('  origin/release/1.0.0\n');

    await findReleaseBranches(git, 'release');

    expect(git.fetch).toHaveBeenCalled();
    expect(git.raw).toHaveBeenCalledWith('branch', '-r');
  });

  it('continues gracefully if fetch fails', async () => {
    const git = createMockGit(
      '  origin/release/1.0.0\n',
      new Error('network error'),
    );

    const result = await findReleaseBranches(git, 'release');

    expect(result.exactMatches).toEqual(['origin/release/1.0.0']);
  });

  it('returns empty results if branch listing fails', async () => {
    const git = {
      fetch: vi.fn().mockResolvedValue(undefined),
      raw: vi.fn().mockRejectedValue(new Error('git error')),
    } as any;

    const result = await findReleaseBranches(git, 'release');

    expect(result.exactMatches).toEqual([]);
    expect(result.fuzzyMatches).toEqual([]);
  });

  it('excludes branches with edit distance > 3', async () => {
    // "rel" has distance 4 from "release" — should NOT match
    const git = createMockGit('  origin/rel/1.0.0\n  origin/r/1.0.0\n');

    const result = await findReleaseBranches(git, 'release');

    expect(result.exactMatches).toEqual([]);
    expect(result.fuzzyMatches).toEqual([]);
  });

  it('handles branches without a slash after prefix', async () => {
    const git = createMockGit('  origin/main\n  origin/release/1.0.0\n');

    const result = await findReleaseBranches(git, 'release');

    expect(result.exactMatches).toEqual(['origin/release/1.0.0']);
    // "main" has distance > 3 from "release", so no fuzzy match
    expect(result.fuzzyMatches).toEqual([]);
  });

  it('matches slashed (monorepo) release-branch prefixes exactly', async () => {
    const git = createMockGit(
      '  origin/release/cli/1.2.0\n' +
        '  origin/release/cli/1.2.1\n' +
        '  origin/release/mcp/2.0.0\n' +
        '  origin/release/1.0.0\n',
    );

    const result = await findReleaseBranches(git, 'release/cli');

    expect(result.exactMatches).toEqual([
      'origin/release/cli/1.2.1',
      'origin/release/cli/1.2.0',
    ]);
    // "release/mcp" is distance 3 from "release/cli" (c→m, l→c, i→p) → fuzzy;
    // "release/1.0.0" has branch-prefix "release" (distance 4) → excluded.
    expect(result.fuzzyMatches).toEqual(['origin/release/mcp/2.0.0']);
  });

  it('does not match a slashed prefix branch that lacks a version segment', async () => {
    const git = createMockGit('  origin/release/cli\n');

    const result = await findReleaseBranches(git, 'release/cli');

    // Cutting at the last "/" yields branch-prefix "release" (no version part
    // for "release/cli"), which does not match/near-match "release/cli".
    expect(result.exactMatches).toEqual([]);
    expect(result.fuzzyMatches).toEqual([]);
  });

  it('treats the prefix opaquely: "release" does not claim "release/cli/x" branches', async () => {
    // With opaque (last-slash) prefix handling, a slashed product branch
    // belongs to its full prefix ("release/cli"), not the bare "release".
    const git = createMockGit(
      '  origin/release/1.0.0\n  origin/release/cli/1.2.3\n',
    );

    const result = await findReleaseBranches(git, 'release');

    // "release/1.0.0" → branch-prefix "release" (exact).
    expect(result.exactMatches).toEqual(['origin/release/1.0.0']);
    // "release/cli/1.2.3" → branch-prefix "release/cli" (distance 4) → excluded.
    expect(result.fuzzyMatches).toEqual([]);
  });
});
