import { vi, describe, test, expect, beforeEach, type Mock } from 'vitest';
import { spawnProcess } from '../../utils/system';
import {
  runPreReleaseCommand,
  checkVersionOrPart,
  assertRemoteConfigAllowed,
} from '../prepare';
import { ConfigurationError } from '../../utils/errors';

vi.mock('../../utils/system');

describe('runPreReleaseCommand', () => {
  const oldVersion = '2.3.3';
  const newVersion = '2.3.4';
  const rootDir = process.cwd();
  const mockedSpawnProcess = spawnProcess as Mock;

  const expectedBaseEnv = () => ({
    PATH: process.env.PATH,
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    HOME: process.env.HOME,
    USER: process.env.USER,
    GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME,
    GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME,
    EMAIL: process.env.EMAIL,
    CRAFT_NEW_VERSION: newVersion,
    CRAFT_OLD_VERSION: oldVersion,
  });

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

describe('assertRemoteConfigAllowed', () => {
  test('throws ConfigurationError when --allow-remote-config is not set', () => {
    expect(() =>
      assertRemoteConfigAllowed('untrusted-branch', false),
    ).toThrowError(ConfigurationError);
    expect(() =>
      assertRemoteConfigAllowed('untrusted-branch', undefined),
    ).toThrowError(ConfigurationError);
  });

  test('error message names the branch and the opt-in flag', () => {
    try {
      assertRemoteConfigAllowed('evil-branch', false);
      throw new Error('expected throw');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain('evil-branch');
      expect(message).toContain('--allow-remote-config');
      expect(message).toContain('CRAFT_ALLOW_REMOTE_CONFIG');
    }
  });

  test('returns silently when opt-in is true', () => {
    expect(() =>
      assertRemoteConfigAllowed('trusted-branch', true),
    ).not.toThrow();
  });
});
