import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as helpers from '../helpers';

// Mock the helpers module to control isDryRun
vi.mock('../helpers', async () => {
  const actual = await vi.importActual('../helpers');
  return {
    ...actual,
    isDryRun: vi.fn(() => false),
  };
});

// Mock the logger
vi.mock('../../logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  createDryRunGit,
  createDryRunOctokit,
  safeFs,
  safeExec,
  safeExecSync,
  logDryRun,
} from '../dryRun';
import { logger } from '../../logger';

describe('dryRun utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('logDryRun', () => {
    it('logs with consistent format', () => {
      logDryRun('test operation');
      expect(logger.info).toHaveBeenCalledWith(
        '[dry-run] Would execute: test operation'
      );
    });
  });

  describe('createDryRunGit', () => {
    const mockGit = {
      push: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue({ commit: 'abc123' }),
      checkout: vi.fn().mockResolvedValue(undefined),
      status: vi.fn().mockResolvedValue({ current: 'main' }),
      log: vi.fn().mockResolvedValue({ all: [] }),
      raw: vi.fn().mockResolvedValue(''),
      revparse: vi.fn().mockResolvedValue('abc123'),
    };

    it('passes through non-mutating methods in normal mode', async () => {
      vi.mocked(helpers.isDryRun).mockReturnValue(false);
      const git = createDryRunGit(mockGit as any);

      await git.status();
      expect(mockGit.status).toHaveBeenCalled();

      await git.log();
      expect(mockGit.log).toHaveBeenCalled();
    });

    it('executes mutating methods in normal mode', async () => {
      vi.mocked(helpers.isDryRun).mockReturnValue(false);
      const git = createDryRunGit(mockGit as any);

      await git.push();
      expect(mockGit.push).toHaveBeenCalled();

      await git.commit('test');
      expect(mockGit.commit).toHaveBeenCalledWith('test');
    });

    it('blocks mutating methods in dry-run mode', async () => {
      vi.mocked(helpers.isDryRun).mockReturnValue(true);
      const git = createDryRunGit(mockGit as any);

      mockGit.push.mockClear();
      await git.push();
      expect(mockGit.push).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('[dry-run]')
      );
    });

    it('blocks git.raw() for mutating commands in dry-run mode', async () => {
      vi.mocked(helpers.isDryRun).mockReturnValue(true);
      const git = createDryRunGit(mockGit as any);

      mockGit.raw.mockClear();
      await git.raw('push', 'origin', 'main');
      expect(mockGit.raw).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('git push origin main')
      );
    });

    it('allows git.raw() for non-mutating commands in dry-run mode', async () => {
      vi.mocked(helpers.isDryRun).mockReturnValue(true);
      const git = createDryRunGit(mockGit as any);

      mockGit.raw.mockClear();
      await git.raw('status');
      expect(mockGit.raw).toHaveBeenCalledWith('status');
    });

    it('passes through read-only methods in dry-run mode', async () => {
      vi.mocked(helpers.isDryRun).mockReturnValue(true);
      const git = createDryRunGit(mockGit as any);

      await git.status();
      expect(mockGit.status).toHaveBeenCalled();

      await git.revparse('HEAD');
      expect(mockGit.revparse).toHaveBeenCalledWith('HEAD');
    });
  });

  describe('createDryRunOctokit', () => {
    const mockOctokit = {
      repos: {
        createRelease: vi.fn().mockResolvedValue({ data: { id: 1 } }),
        getContent: vi.fn().mockResolvedValue({ data: {} }),
        updateRelease: vi.fn().mockResolvedValue({ data: {} }),
        deleteReleaseAsset: vi.fn().mockResolvedValue({ status: 204 }),
      },
      rest: {
        git: {
          createRef: vi.fn().mockResolvedValue({ data: {} }),
        },
      },
    };

    it('passes through read methods in normal mode', async () => {
      vi.mocked(helpers.isDryRun).mockReturnValue(false);
      const octokit = createDryRunOctokit(mockOctokit as any);

      await octokit.repos.getContent({ owner: 'test', repo: 'test', path: '/' });
      expect(mockOctokit.repos.getContent).toHaveBeenCalled();
    });

    it('executes mutating methods in normal mode', async () => {
      vi.mocked(helpers.isDryRun).mockReturnValue(false);
      const octokit = createDryRunOctokit(mockOctokit as any);

      await octokit.repos.createRelease({
        owner: 'test',
        repo: 'test',
        tag_name: 'v1.0.0',
      });
      expect(mockOctokit.repos.createRelease).toHaveBeenCalled();
    });

    it('blocks mutating methods in dry-run mode', async () => {
      vi.mocked(helpers.isDryRun).mockReturnValue(true);
      const octokit = createDryRunOctokit(mockOctokit as any);

      mockOctokit.repos.createRelease.mockClear();
      await octokit.repos.createRelease({
        owner: 'test',
        repo: 'test',
        tag_name: 'v1.0.0',
      });
      expect(mockOctokit.repos.createRelease).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('[dry-run]')
      );
    });

    it('blocks nested mutating methods in dry-run mode', async () => {
      vi.mocked(helpers.isDryRun).mockReturnValue(true);
      const octokit = createDryRunOctokit(mockOctokit as any);

      mockOctokit.rest.git.createRef.mockClear();
      await octokit.rest.git.createRef({
        owner: 'test',
        repo: 'test',
        ref: 'refs/tags/v1.0.0',
        sha: 'abc123',
      });
      expect(mockOctokit.rest.git.createRef).not.toHaveBeenCalled();
    });

    it('passes through read methods in dry-run mode', async () => {
      vi.mocked(helpers.isDryRun).mockReturnValue(true);
      const octokit = createDryRunOctokit(mockOctokit as any);

      await octokit.repos.getContent({ owner: 'test', repo: 'test', path: '/' });
      expect(mockOctokit.repos.getContent).toHaveBeenCalled();
    });
  });

  describe('safeFs', () => {
    // We can't easily test actual fs operations, so we test the dry-run behavior
    it('logs instead of writing in dry-run mode', async () => {
      vi.mocked(helpers.isDryRun).mockReturnValue(true);

      await safeFs.writeFile('/tmp/test.txt', 'content');
      expect(logger.info).toHaveBeenCalledWith(
        '[dry-run] Would execute: fs.writeFile(/tmp/test.txt)'
      );
    });

    it('logs instead of unlinking in dry-run mode', async () => {
      vi.mocked(helpers.isDryRun).mockReturnValue(true);

      await safeFs.unlink('/tmp/test.txt');
      expect(logger.info).toHaveBeenCalledWith(
        '[dry-run] Would execute: fs.unlink(/tmp/test.txt)'
      );
    });

    it('logs instead of renaming in dry-run mode', async () => {
      vi.mocked(helpers.isDryRun).mockReturnValue(true);

      await safeFs.rename('/tmp/old.txt', '/tmp/new.txt');
      expect(logger.info).toHaveBeenCalledWith(
        '[dry-run] Would execute: fs.rename(/tmp/old.txt, /tmp/new.txt)'
      );
    });
  });

  describe('safeExec', () => {
    it('executes action in normal mode', async () => {
      vi.mocked(helpers.isDryRun).mockReturnValue(false);
      const action = vi.fn().mockResolvedValue('result');

      const result = await safeExec(action, 'test action');

      expect(action).toHaveBeenCalled();
      expect(result).toBe('result');
    });

    it('skips action and logs in dry-run mode', async () => {
      vi.mocked(helpers.isDryRun).mockReturnValue(true);
      const action = vi.fn().mockResolvedValue('result');

      const result = await safeExec(action, 'test action');

      expect(action).not.toHaveBeenCalled();
      expect(result).toBeUndefined();
      expect(logger.info).toHaveBeenCalledWith(
        '[dry-run] Would execute: test action'
      );
    });
  });

  describe('safeExecSync', () => {
    it('executes action in normal mode', () => {
      vi.mocked(helpers.isDryRun).mockReturnValue(false);
      const action = vi.fn().mockReturnValue('result');

      const result = safeExecSync(action, 'test action');

      expect(action).toHaveBeenCalled();
      expect(result).toBe('result');
    });

    it('skips action and logs in dry-run mode', () => {
      vi.mocked(helpers.isDryRun).mockReturnValue(true);
      const action = vi.fn().mockReturnValue('result');

      const result = safeExecSync(action, 'test action');

      expect(action).not.toHaveBeenCalled();
      expect(result).toBeUndefined();
      expect(logger.info).toHaveBeenCalledWith(
        '[dry-run] Would execute: test action'
      );
    });
  });
});
