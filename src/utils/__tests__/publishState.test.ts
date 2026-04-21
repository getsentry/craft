import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { homedir } from 'os';
import { join } from 'path';

import {
  getCraftStateDir,
  getPublishStateFilename,
  getPublishStatePath,
} from '../publishState';

describe('publishState', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.XDG_STATE_HOME;
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  describe('getCraftStateDir', () => {
    test('defaults to $HOME/.local/state/craft when XDG_STATE_HOME is unset', () => {
      expect(getCraftStateDir()).toBe(
        join(homedir(), '.local', 'state', 'craft'),
      );
    });

    test('honours XDG_STATE_HOME when set', () => {
      process.env.XDG_STATE_HOME = '/var/lib/ci-state';
      expect(getCraftStateDir()).toBe('/var/lib/ci-state/craft');
    });

    test('falls back to HOME when XDG_STATE_HOME is empty string', () => {
      process.env.XDG_STATE_HOME = '';
      expect(getCraftStateDir()).toBe(
        join(homedir(), '.local', 'state', 'craft'),
      );
    });
  });

  describe('getPublishStateFilename', () => {
    const cwd = '/workspace/repo';

    test('includes owner, repo, short cwd hash, and version', () => {
      const name = getPublishStateFilename(
        '1.2.3',
        { owner: 'getsentry', repo: 'craft' },
        cwd,
      );
      expect(name).toMatch(
        /^publish-state-getsentry-craft-[0-9a-f]{12}-1\.2\.3\.json$/,
      );
    });

    test('disambiguates monorepo subpaths via cwd hash', () => {
      const a = getPublishStateFilename(
        '1.2.3',
        { owner: 'o', repo: 'r' },
        '/workspace/repo/packages/foo',
      );
      const b = getPublishStateFilename(
        '1.2.3',
        { owner: 'o', repo: 'r' },
        '/workspace/repo/packages/bar',
      );
      expect(a).not.toBe(b);
    });

    test('sanitises owner/repo/version characters', () => {
      const name = getPublishStateFilename(
        '1.2.3+build/hack$',
        { owner: 'Weird Owner', repo: 'Re po!' },
        cwd,
      );
      // No slashes, no plus, no dollar — all collapsed to underscores.
      expect(name).not.toMatch(/[/$+!]/);
      expect(name).toMatch(/^publish-state-weird_owner-re_po-[0-9a-f]{12}-/);
    });

    test('falls back to sha256(cwd)-only filename when github config is null', () => {
      const name = getPublishStateFilename('1.2.3', null, cwd);
      expect(name).toMatch(/^publish-state-[0-9a-f]{16}-1\.2\.3\.json$/);
    });

    test('fallback filename also disambiguates by cwd', () => {
      const a = getPublishStateFilename('1.0.0', null, '/a');
      const b = getPublishStateFilename('1.0.0', null, '/b');
      expect(a).not.toBe(b);
    });

    test('same inputs produce stable filenames', () => {
      const a = getPublishStateFilename(
        '1.2.3',
        { owner: 'o', repo: 'r' },
        cwd,
      );
      const b = getPublishStateFilename(
        '1.2.3',
        { owner: 'o', repo: 'r' },
        cwd,
      );
      expect(a).toBe(b);
    });
  });

  describe('getPublishStatePath', () => {
    test('joins state dir + filename', () => {
      process.env.XDG_STATE_HOME = '/var/state';
      const path = getPublishStatePath(
        '1.2.3',
        { owner: 'o', repo: 'r' },
        '/workspace/repo',
      );
      expect(path.startsWith('/var/state/craft/')).toBe(true);
      expect(path.endsWith('-1.2.3.json')).toBe(true);
    });

    test('does not place the state file inside cwd', () => {
      // This is the crucial security property: the file must NEVER
      // live inside the repository being published, because repo
      // contents are attacker-influenceable via PRs.
      const cwd = '/workspace/untrusted-repo';
      process.env.XDG_STATE_HOME = '/var/state';
      const path = getPublishStatePath('1.2.3', { owner: 'o', repo: 'r' }, cwd);
      expect(path.startsWith(cwd)).toBe(false);
    });

    test('does not place fallback state file inside cwd', () => {
      // Same property must hold when github config is unavailable.
      const cwd = '/workspace/untrusted-repo';
      process.env.XDG_STATE_HOME = '/var/state';
      const path = getPublishStatePath('1.2.3', null, cwd);
      expect(path.startsWith(cwd)).toBe(false);
    });
  });
});
