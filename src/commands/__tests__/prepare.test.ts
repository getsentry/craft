import { vi, describe, test, expect, beforeEach, type Mock } from 'vitest';
import { spawnProcess } from '../../utils/system';
import { runPreReleaseCommand, checkVersionOrPart } from '../prepare';

vi.mock('../../utils/system');

describe('runPreReleaseCommand', () => {
  const oldVersion = '2.3.3';
  const newVersion = '2.3.4';
  const rootDir = process.cwd();
  const mockedSpawnProcess = spawnProcess as Mock;

  const expectedBaseEnv = () => {
    const env: Record<string, string | undefined> = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      USER: process.env.USER,
      GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME,
      GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME,
      EMAIL: process.env.EMAIL,
    };
    // Prefix-match keys are forwarded as a group — enumerate whatever's
    // currently on `process.env` (keeps the test stable across local
    // runs, CI runs with GHA env, and CI runs with runner env).
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('GITHUB_') || key.startsWith('RUNNER_')) {
        env[key] = process.env[key];
      }
    }
    env.CRAFT_NEW_VERSION = newVersion;
    env.CRAFT_OLD_VERSION = oldVersion;
    return env;
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('runs with default command', async () => {
    expect.assertions(1);

    await runPreReleaseCommand({
      oldVersion,
      newVersion,
      rootDir,
      preReleaseCommand: 'scripts/bump-version.sh',
    });

    expect(mockedSpawnProcess).toBeCalledWith(
      'scripts/bump-version.sh',
      [oldVersion, newVersion],
      { env: expectedBaseEnv() },
    );
  });

  test('runs with custom command', async () => {
    expect.assertions(1);

    await runPreReleaseCommand({
      oldVersion,
      newVersion,
      rootDir,
      preReleaseCommand: 'python ./increase_version.py "argument 1"',
    });

    expect(mockedSpawnProcess).toBeCalledWith(
      'python',
      ['./increase_version.py', 'argument 1', oldVersion, newVersion],
      { env: expectedBaseEnv() },
    );
  });

  test('does not forward arbitrary env vars from process.env', async () => {
    // Simulate an attacker having planted secrets / linker hijacks in
    // process.env (e.g. via a compromised parent process or a malicious
    // earlier CI step). The allowlist must keep these out of the child.
    const sentinel = '__SHOULD_NOT_LEAK__';
    const before = {
      LD_PRELOAD: process.env.LD_PRELOAD,
      AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
      SECRET_TOKEN: process.env.SECRET_TOKEN,
    };
    process.env.LD_PRELOAD = `/tmp/evil.so-${sentinel}`;
    process.env.AWS_SECRET_ACCESS_KEY = `aws-${sentinel}`;
    process.env.SECRET_TOKEN = `token-${sentinel}`;

    try {
      await runPreReleaseCommand({
        oldVersion,
        newVersion,
        rootDir,
        preReleaseCommand: 'scripts/bump-version.sh',
      });

      const spawnCall = mockedSpawnProcess.mock.calls[0];
      const envArg = spawnCall[2].env as Record<string, unknown>;

      // Allowlist keys are present (values taken from process.env at call
      // time, which is fine — they're allowlisted by name).
      expect(envArg.CRAFT_NEW_VERSION).toBe(newVersion);
      expect(envArg.CRAFT_OLD_VERSION).toBe(oldVersion);

      // Dangerous / attacker-planted vars must NOT appear.
      expect(envArg.LD_PRELOAD).toBeUndefined();
      expect(envArg.AWS_SECRET_ACCESS_KEY).toBeUndefined();
      expect(envArg.SECRET_TOKEN).toBeUndefined();

      // Defensive: the sentinel must not appear in ANY value.
      for (const v of Object.values(envArg)) {
        if (typeof v === 'string') {
          expect(v).not.toContain(sentinel);
        }
      }
    } finally {
      // Restore prior env.
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
    // Regression test for the sentry-cocoa breakage where
    // ./scripts/update-package-sha.sh read GITHUB_RUN_ID and exploded
    // with "unbound variable" because Craft was stripping the whole
    // GITHUB_* namespace.
    const before = {
      GITHUB_RUN_ID: process.env.GITHUB_RUN_ID,
      GITHUB_REPOSITORY: process.env.GITHUB_REPOSITORY,
      RUNNER_OS: process.env.RUNNER_OS,
      NPM_TOKEN: process.env.NPM_TOKEN,
      DOCKER_PASSWORD: process.env.DOCKER_PASSWORD,
    };
    process.env.GITHUB_RUN_ID = '123456';
    process.env.GITHUB_REPOSITORY = 'getsentry/sentry-cocoa';
    process.env.RUNNER_OS = 'Linux';
    process.env.NPM_TOKEN = 'npm_xxx_must_not_leak';
    process.env.DOCKER_PASSWORD = 'dockerpw_must_not_leak';

    try {
      await runPreReleaseCommand({
        oldVersion,
        newVersion,
        rootDir,
        preReleaseCommand: 'scripts/bump-version.sh',
      });

      const envArg = mockedSpawnProcess.mock.calls[0][2].env as Record<
        string,
        unknown
      >;

      // GITHUB_* and RUNNER_* pass through.
      expect(envArg.GITHUB_RUN_ID).toBe('123456');
      expect(envArg.GITHUB_REPOSITORY).toBe('getsentry/sentry-cocoa');
      expect(envArg.RUNNER_OS).toBe('Linux');

      // Credential-named vars do not.
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

describe('checkVersionOrPart', () => {
  test('return true for valid version', () => {
    const validVersions = ['2.3.3', '0.0.1'];
    for (const v of validVersions) {
      expect(
        checkVersionOrPart(
          {
            newVersion: v,
          },
          null,
        ),
      ).toBe(true);
    }
  });

  test('return true for auto version', () => {
    expect(
      checkVersionOrPart(
        {
          newVersion: 'auto',
        },
        null,
      ),
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
          null,
        ),
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
        e: 'Invalid version or version part specified: "v2.3.3". Removing the "v" prefix will likely fix the issue',
      },
    ];
    for (const t of invalidVersions) {
      const fn = () => {
        checkVersionOrPart(
          {
            newVersion: t.v,
          },
          null,
        );
      };
      expect(fn).toThrow(t.e);
    }
  });
});
