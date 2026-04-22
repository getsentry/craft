import { vi, describe, test, expect, beforeEach, type Mock } from 'vitest';
import { join as pathJoin } from 'path';
import { spawnProcess, hasExecutable } from '../../utils/system';
import {
  runPostReleaseCommand,
  handleReleaseBranch,
  MergeConflictError,
  PushError,
} from '../publish';
import type { SimpleGit } from 'simple-git';

vi.mock('../../utils/system');
vi.mock('../../utils/git', () => ({
  getDefaultBranch: vi.fn().mockResolvedValue('main'),
  getGitClient: vi.fn(),
  isRepoDirty: vi.fn(),
  findReleaseBranches: vi.fn(),
}));

describe('runPostReleaseCommand', () => {
  const newVersion = '2.3.4';
  const mockedSpawnProcess = spawnProcess as Mock;
  const mockedHasExecutable = hasExecutable as Mock;

  const expectedBaseEnv = () => {
    const env: Record<string, string | undefined> = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      USER: process.env.USER,
      GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME,
      GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME,
      EMAIL: process.env.EMAIL,
    };
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('GITHUB_') || key.startsWith('RUNNER_')) {
        env[key] = process.env[key];
      }
    }
    env.CRAFT_RELEASED_VERSION = newVersion;
    return env;
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('default script', () => {
    test('runs when script exists', async () => {
      mockedHasExecutable.mockReturnValue(true);
      expect.assertions(1);

      await runPostReleaseCommand(newVersion);

      expect(mockedSpawnProcess).toHaveBeenCalledWith(
        '/bin/bash',
        [pathJoin('scripts', 'post-release.sh'), '', newVersion],
        { env: expectedBaseEnv() },
      );
    });

    test('skips when script does not exist', async () => {
      mockedHasExecutable.mockReturnValue(false);
      expect.assertions(1);

      await runPostReleaseCommand(newVersion);

      expect(mockedSpawnProcess).not.toHaveBeenCalled();
    });
  });

  test('runs with custom command', async () => {
    expect.assertions(1);

    await runPostReleaseCommand(
      newVersion,
      'python ./increase_version.py "argument 1"',
    );

    expect(mockedSpawnProcess).toHaveBeenCalledWith(
      'python',
      ['./increase_version.py', 'argument 1', '', newVersion],
      { env: expectedBaseEnv() },
    );
  });

  test('does not forward arbitrary env vars from process.env', async () => {
    // Same threat model as runPreReleaseCommand: attacker-planted env vars
    // must not leak to the post-release subprocess.
    const sentinel = '__POST_RELEASE_SHOULD_NOT_LEAK__';
    const before = {
      LD_PRELOAD: process.env.LD_PRELOAD,
      AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
      SECRET_TOKEN: process.env.SECRET_TOKEN,
    };
    process.env.LD_PRELOAD = `/tmp/evil.so-${sentinel}`;
    process.env.AWS_SECRET_ACCESS_KEY = `aws-${sentinel}`;
    process.env.SECRET_TOKEN = `token-${sentinel}`;

    try {
      await runPostReleaseCommand(newVersion, 'bash -c true');

      const spawnCall = mockedSpawnProcess.mock.calls[0];
      const envArg = spawnCall[2].env as Record<string, unknown>;

      expect(envArg.CRAFT_RELEASED_VERSION).toBe(newVersion);
      expect(envArg.LD_PRELOAD).toBeUndefined();
      expect(envArg.AWS_SECRET_ACCESS_KEY).toBeUndefined();
      expect(envArg.SECRET_TOKEN).toBeUndefined();

      for (const v of Object.values(envArg)) {
        if (typeof v === 'string') {
          expect(v).not.toContain(sentinel);
        }
      }
    } finally {
      for (const [key, val] of Object.entries(before)) {
        if (val === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = val;
        }
      }
    }
  });

  test('forwards GITHUB_* and RUNNER_* by prefix, not credential-named vars', async () => {
    const before = {
      GITHUB_RUN_ID: process.env.GITHUB_RUN_ID,
      GITHUB_REPOSITORY: process.env.GITHUB_REPOSITORY,
      RUNNER_OS: process.env.RUNNER_OS,
      NPM_TOKEN: process.env.NPM_TOKEN,
      DOCKER_PASSWORD: process.env.DOCKER_PASSWORD,
    };
    process.env.GITHUB_RUN_ID = '9876';
    process.env.GITHUB_REPOSITORY = 'getsentry/sentry-cocoa';
    process.env.RUNNER_OS = 'Linux';
    process.env.NPM_TOKEN = 'npm_xxx_must_not_leak';
    process.env.DOCKER_PASSWORD = 'dockerpw_must_not_leak';

    try {
      await runPostReleaseCommand(newVersion, 'bash -c true');

      const envArg = mockedSpawnProcess.mock.calls[0][2].env as Record<
        string,
        unknown
      >;

      expect(envArg.GITHUB_RUN_ID).toBe('9876');
      expect(envArg.GITHUB_REPOSITORY).toBe('getsentry/sentry-cocoa');
      expect(envArg.RUNNER_OS).toBe('Linux');
      expect(envArg.NPM_TOKEN).toBeUndefined();
      expect(envArg.DOCKER_PASSWORD).toBeUndefined();
    } finally {
      for (const [key, val] of Object.entries(before)) {
        if (val === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = val;
        }
      }
    }
  });
});

describe('handleReleaseBranch', () => {
  /**
   * Creates a mock SimpleGit instance where each method returns
   * a chainable object (SimpleGit & Promise), matching simple-git's API.
   */
  function createMockGit() {
    const mockGit: Record<string, Mock> = {};

    // Each method returns a chainable proxy that is both a Promise and
    // has all the same mock methods available for chaining.
    const makeChainable = (resolvedValue: any = undefined) => {
      const fn = vi.fn().mockImplementation((..._args: any[]) => {
        // Return a thenable that also has all mock methods
        const result = Promise.resolve(resolvedValue);
        // Attach all mock methods to the promise for chaining
        for (const key of Object.keys(mockGit)) {
          (result as any)[key] = mockGit[key];
        }
        return result;
      });
      return fn;
    };

    mockGit.checkout = makeChainable();
    mockGit.pull = makeChainable({ files: [] });
    mockGit.merge = makeChainable();
    mockGit.push = makeChainable();
    mockGit.branch = makeChainable();
    mockGit.remote = makeChainable();
    mockGit.revparse = makeChainable('main');
    mockGit.raw = makeChainable('');
    mockGit.status = makeChainable({ conflicted: [] });
    mockGit.diff = makeChainable('');

    return mockGit as unknown as SimpleGit & Record<string, Mock>;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('successful merge with default strategy', async () => {
    const git = createMockGit();

    await handleReleaseBranch(git, 'origin', 'release/1.0.0', 'main');

    expect(git.checkout).toHaveBeenCalledWith('main');
    expect(git.pull).toHaveBeenCalledWith('origin', 'main', ['--rebase']);
    expect(git.merge).toHaveBeenCalledTimes(1);
    expect(git.merge).toHaveBeenCalledWith([
      '--no-ff',
      '--no-edit',
      'release/1.0.0',
    ]);
    expect(git.push).toHaveBeenCalledWith('origin', 'main');
  });

  test('retries with resolve strategy when default merge fails', async () => {
    const git = createMockGit();
    const mergeError = new Error(
      'CONFLICT (content): Merge conflict in CHANGELOG.md',
    );

    // First merge call fails, abort succeeds, retry succeeds
    (git.merge as Mock)
      .mockImplementationOnce(() => Promise.reject(mergeError))
      .mockImplementationOnce(() => {
        // merge --abort
        return Promise.resolve();
      })
      .mockImplementationOnce(() => {
        // retry with -s resolve
        return Promise.resolve();
      });

    await handleReleaseBranch(git, 'origin', 'release/1.0.0', 'main');

    expect(git.merge).toHaveBeenCalledTimes(3);
    // First attempt: default strategy
    expect(git.merge).toHaveBeenNthCalledWith(1, [
      '--no-ff',
      '--no-edit',
      'release/1.0.0',
    ]);
    // Abort the failed merge
    expect(git.merge).toHaveBeenNthCalledWith(2, ['--abort']);
    // Retry with resolve strategy
    expect(git.merge).toHaveBeenNthCalledWith(3, [
      '-s',
      'resolve',
      '--no-ff',
      '--no-edit',
      'release/1.0.0',
    ]);
    // Push should still be called after successful retry
    expect(git.push).toHaveBeenCalledWith('origin', 'main');
  });

  test('retries with resolve even when merge --abort fails', async () => {
    const git = createMockGit();
    const mergeError = new Error('CONFLICT');
    const abortError = new Error('fatal: There is no merge to abort');

    (git.merge as Mock)
      .mockImplementationOnce(() => Promise.reject(mergeError))
      .mockImplementationOnce(() => Promise.reject(abortError))
      .mockImplementationOnce(() => Promise.resolve());

    await handleReleaseBranch(git, 'origin', 'release/1.0.0', 'main');

    expect(git.merge).toHaveBeenCalledTimes(3);
    expect(git.merge).toHaveBeenNthCalledWith(2, ['--abort']);
    expect(git.merge).toHaveBeenNthCalledWith(3, [
      '-s',
      'resolve',
      '--no-ff',
      '--no-edit',
      'release/1.0.0',
    ]);
    expect(git.push).toHaveBeenCalledWith('origin', 'main');
  });

  test('throws MergeConflictError with file list when both strategies fail', async () => {
    const git = createMockGit();
    const defaultError = new Error('CONFLICT with default');
    const resolveError = new Error('CONFLICT with resolve');

    (git.merge as Mock)
      .mockImplementationOnce(() => Promise.reject(defaultError)) // default merge
      .mockImplementationOnce(() => Promise.resolve()) // abort after default
      .mockImplementationOnce(() => Promise.reject(resolveError)) // resolve merge
      .mockImplementationOnce(() => Promise.resolve()); // abort after resolve

    // Simulate conflicted files in git status
    (git.status as Mock).mockImplementationOnce(() =>
      Promise.resolve({ conflicted: ['CHANGELOG.md', 'package.json'] }),
    );

    const fakeDiff =
      '<<<<<<< HEAD\nold content\n=======\nnew content\n>>>>>>> release/1.0.0';
    (git.diff as Mock).mockImplementationOnce(() => Promise.resolve(fakeDiff));

    const error = await handleReleaseBranch(
      git,
      'origin',
      'release/1.0.0',
      'main',
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(MergeConflictError);
    const conflictError = error as MergeConflictError;
    expect(conflictError.message).toBe('CONFLICT with resolve');
    expect(conflictError.conflictedFiles).toEqual([
      'CHANGELOG.md',
      'package.json',
    ]);
    expect(conflictError.diff).toBe(fakeDiff);

    expect(git.merge).toHaveBeenCalledTimes(4);
    expect(git.merge).toHaveBeenNthCalledWith(2, ['--abort']);
    expect(git.merge).toHaveBeenNthCalledWith(4, ['--abort']);
    expect(git.status).toHaveBeenCalledTimes(1);
    expect(git.diff).toHaveBeenCalledWith(['CHANGELOG.md', 'package.json']);
    // push should NOT be called
    expect(git.push).not.toHaveBeenCalledWith('origin', 'main');
  });

  test('throws PushError when push fails after successful merge', async () => {
    const git = createMockGit();
    const pushError = new Error(
      "fatal: could not read Username for 'https://github.com': No such device or address",
    );

    (git.push as Mock).mockImplementationOnce(() => Promise.reject(pushError));

    const error = await handleReleaseBranch(
      git,
      'origin',
      'release/1.0.0',
      'main',
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PushError);
    expect((error as PushError).message).toContain('could not read Username');
    // Merge should have been called (and succeeded)
    expect(git.merge).toHaveBeenCalledTimes(1);
  });

  test('aborts rebase when pull --rebase fails', async () => {
    const git = createMockGit();
    const pullError = new Error('CONFLICT during rebase');

    (git.pull as Mock).mockImplementationOnce(() => Promise.reject(pullError));

    await expect(
      handleReleaseBranch(git, 'origin', 'release/1.0.0', 'main'),
    ).rejects.toThrow('CONFLICT during rebase');

    // rebase --abort should have been called to clean up
    expect(git.raw).toHaveBeenCalledWith(['rebase', '--abort']);
    // merge and push should NOT be called
    expect(git.merge).not.toHaveBeenCalled();
    expect(git.push).not.toHaveBeenCalledWith('origin', 'main');
  });

  test('deletes branch after successful merge', async () => {
    const git = createMockGit();

    await handleReleaseBranch(git, 'origin', 'release/1.0.0', 'main', false);

    expect(git.branch).toHaveBeenCalledWith(['-D', 'release/1.0.0']);
    // push --delete is chained from branch()
    expect(git.push).toHaveBeenCalledWith([
      'origin',
      '--delete',
      'release/1.0.0',
    ]);
  });

  test('does not delete branch when keepBranch is true', async () => {
    const git = createMockGit();

    await handleReleaseBranch(git, 'origin', 'release/1.0.0', 'main', true);

    expect(git.branch).not.toHaveBeenCalledWith(['-D', 'release/1.0.0']);
  });

  test('resolves default branch when mergeTarget is not provided', async () => {
    const { getDefaultBranch } = await import('../../utils/git');
    vi.mocked(getDefaultBranch).mockResolvedValue('master');

    const git = createMockGit();

    await handleReleaseBranch(git, 'origin', 'release/1.0.0');

    expect(getDefaultBranch).toHaveBeenCalledWith(git, 'origin');
    expect(git.checkout).toHaveBeenCalledWith('master');
    expect(git.pull).toHaveBeenCalledWith('origin', 'master', ['--rebase']);
    expect(git.push).toHaveBeenCalledWith('origin', 'master');
  });
});

describe('MergeConflictError', () => {
  test('is instanceof Error', () => {
    const err = new MergeConflictError('conflict', ['a.txt'], '');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(MergeConflictError);
  });

  test('carries conflictedFiles and diff', () => {
    const diff = '<<<<<<< HEAD\nold\n=======\nnew\n>>>>>>>';
    const err = new MergeConflictError(
      'msg',
      ['CHANGELOG.md', 'package.json'],
      diff,
    );
    expect(err.message).toBe('msg');
    expect(err.conflictedFiles).toEqual(['CHANGELOG.md', 'package.json']);
    expect(err.diff).toBe(diff);
  });

  test('works with empty conflictedFiles and no diff', () => {
    const err = new MergeConflictError('msg', [], '');
    expect(err.conflictedFiles).toEqual([]);
    expect(err.diff).toBe('');
  });
});

describe('PushError', () => {
  test('is instanceof Error', () => {
    const err = new PushError('push failed');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(PushError);
  });

  test('carries message', () => {
    const err = new PushError('could not read Username');
    expect(err.message).toBe('could not read Username');
  });
});
