import { vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createGitClient,
  getChangesSince,
  getLatestTag,
  isRepoDirty,
  findReleaseBranches,
} from '../git';
import * as loggerModule from '../../logger';
import type { StatusResult } from 'simple-git';
import { setActiveWorkspace } from '../../config';

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

describe('getChangesSince', () => {
  it('includes commits in a first release with no previous tag', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'craft-first-release-'));
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', dir, ...args], {
        env: {
          ...process.env,
          GIT_CONFIG_GLOBAL: '/dev/null',
          GIT_CONFIG_NOSYSTEM: '1',
        },
      });

    try {
      git('init', '--quiet');
      git('config', 'user.name', 'Craft Test');
      git('config', 'user.email', 'craft-test@example.com');
      writeFileSync(join(dir, 'entry.md'), 'first\n');
      git('add', 'entry.md');
      git(
        '-c',
        'commit.gpgsign=false',
        'commit',
        '--quiet',
        '-m',
        'First change',
      );
      git('tag', 'cli@0.1.0');
      writeFileSync(join(dir, 'entry.md'), 'second\n');
      git('add', 'entry.md');
      git(
        '-c',
        'commit.gpgsign=false',
        'commit',
        '--quiet',
        '-m',
        'Second change',
      );

      const client = createGitClient(dir);
      expect(
        (await getChangesSince(client, '')).map(({ title }) => title),
      ).toEqual(['Second change', 'First change']);
      expect(
        (await getChangesSince(client, '', 'cli@0.1.0')).map(
          ({ title }) => title,
        ),
      ).toEqual(['First change']);
      expect(
        (await getChangesSince(client, 'cli@0.1.0')).map(({ title }) => title),
      ).toEqual(['Second change']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('includes shared and selected workspace changes, with optional related paths', async () => {
    const dir = mkdtempSync('/tmp/opencode/craft-changelog-workspaces-');
    const previousDirectory = process.cwd();
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', dir, ...args], {
        env: {
          ...process.env,
          GIT_CONFIG_GLOBAL: '/dev/null',
          GIT_CONFIG_NOSYSTEM: '1',
        },
      });
    const commit = (
      file: string,
      title: string,
      additionalFiles: string[] = [],
    ) => {
      writeFileSync(join(dir, file), title);
      git('add', '--', file, ...additionalFiles);
      git('-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', title);
    };

    try {
      git('init', '--quiet');
      git('config', 'user.name', 'Craft Test');
      git('config', 'user.email', 'craft-test@example.com');
      for (const workspace of [
        'packages/cli',
        'packages/mcp',
        'apps/cli-docs',
        'apps/cli-docs-extra',
      ]) {
        mkdirSync(join(dir, workspace), { recursive: true });
        writeFileSync(
          join(dir, workspace, 'package.json'),
          JSON.stringify({ name: workspace }),
        );
      }
      mkdirSync(join(dir, 'docs'));
      writeFileSync(
        join(dir, '.craft.yml'),
        'minVersion: 2.29.0\nworkspaces:\n  packages/cli:\n    changelog:\n      policy: auto\n  packages/mcp: {}\n',
      );
      writeFileSync(
        join(dir, 'pnpm-workspace.yaml'),
        'packages:\n  - packages/*\n  - apps/*\n',
      );
      git('add', '.');
      git('-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'initial');
      git('tag', 'cli@0.1.0');
      commit('packages/cli/cli.ts', 'cli change');
      commit('packages/mcp/mcp.ts', 'mcp change');
      commit('apps/cli-docs/site.ts', 'cli docs change');
      commit('apps/cli-docs-extra/site.ts', 'other docs change');
      commit('docs/readme.md', 'unowned docs change');
      commit('root.txt', 'root change');
      writeFileSync(join(dir, 'packages/cli/cli.ts'), 'shared change');
      commit('packages/mcp/mcp.ts', 'both change', ['packages/cli/cli.ts']);

      process.chdir(dir);
      setActiveWorkspace('packages/cli');
      const client = createGitClient(dir);
      const titles = async () =>
        (await getChangesSince(client, 'cli@0.1.0')).map(({ title }) => title);

      expect(await titles()).toEqual([
        'both change',
        'root change',
        'unowned docs change',
        'cli change',
      ]);
      expect(
        (await getChangesSince(client, '', 'cli@0.1.0')).map(
          ({ title }) => title,
        ),
      ).toEqual(['initial']);

      setActiveWorkspace('packages/mcp');
      expect(await titles()).toEqual([
        'both change',
        'root change',
        'unowned docs change',
        'mcp change',
      ]);
      setActiveWorkspace('packages/cli');

      writeFileSync(
        join(dir, '.craft.yml'),
        'minVersion: 2.29.0\nworkspaces:\n  packages/cli:\n    changelog:\n      policy: auto\n      includePaths:\n        - apps/cli-docs\n  packages/mcp: {}\n',
      );
      setActiveWorkspace('packages/cli');
      expect(await titles()).toEqual([
        'both change',
        'root change',
        'unowned docs change',
        'cli docs change',
        'cli change',
      ]);

      git('mv', 'packages/cli/cli.ts', 'packages/mcp/moved.ts');
      git(
        '-c',
        'commit.gpgsign=false',
        'commit',
        '--quiet',
        '-m',
        'moved across workspaces',
      );
      commit('packages/cli/line\nbreak.ts', 'newline filename');
      expect(await titles()).toEqual([
        'newline filename',
        'moved across workspaces',
        'both change',
        'root change',
        'unowned docs change',
        'cli docs change',
        'cli change',
      ]);
      setActiveWorkspace('packages/mcp');
      expect((await titles()).slice(0, 2)).toEqual([
        'moved across workspaces',
        'both change',
      ]);
    } finally {
      setActiveWorkspace(undefined);
      process.chdir(previousDirectory);
      rmSync(dir, { recursive: true, force: true });
    }
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
