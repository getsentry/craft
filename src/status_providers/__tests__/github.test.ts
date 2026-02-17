import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../logger', () => ({
  logger: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    withScope: vi.fn().mockReturnThis(),
  },
}));

vi.mock('../../utils/githubApi', () => ({
  getGitHubClient: vi.fn().mockReturnValue({
    repos: {
      getCombinedStatusForRef: vi.fn(),
      get: vi.fn(),
    },
    checks: {
      listSuitesForRef: vi.fn(),
      listForRef: vi.fn(),
    },
  }),
}));

import { GitHubStatusProvider } from '../github';
import { CommitStatus } from '../base';
import { getGitHubClient } from '../../utils/githubApi';

function getGitHubMock() {
  return (getGitHubClient as ReturnType<typeof vi.fn>)() as {
    repos: {
      getCombinedStatusForRef: ReturnType<typeof vi.fn>;
      get: ReturnType<typeof vi.fn>;
    };
    checks: {
      listSuitesForRef: ReturnType<typeof vi.fn>;
      listForRef: ReturnType<typeof vi.fn>;
    };
  };
}

describe('GitHubStatusProvider', () => {
  const githubConfig = { owner: 'test-owner', repo: 'test-repo' };
  let provider: GitHubStatusProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new GitHubStatusProvider({ name: 'github' }, githubConfig);
  });

  describe('getFailureDetails', () => {
    it('returns empty details with "See all checks" link when no data is cached', () => {
      const details = provider.getFailureDetails('abc123');
      expect(details).toEqual([
        '\nSee all checks: https://github.com/test-owner/test-repo/commit/abc123',
      ]);
    });

    it('lists failed legacy commit statuses', async () => {
      const github = getGitHubMock();
      github.repos.getCombinedStatusForRef.mockResolvedValue({
        data: {
          state: 'failure',
          total_count: 2,
          statuses: [
            {
              context: 'ci/tests',
              state: 'success',
              target_url: 'https://ci.example.com/1',
            },
            {
              context: 'ci/lint',
              state: 'failure',
              target_url: 'https://ci.example.com/2',
            },
          ],
        },
      });
      github.checks.listSuitesForRef.mockResolvedValue({
        data: { check_suites: [] },
      });
      github.checks.listForRef.mockResolvedValue({
        data: { total_count: 0, check_runs: [] },
      });

      const status = await provider.getRevisionStatus('abc123');
      expect(status).toBe(CommitStatus.FAILURE);

      const details = provider.getFailureDetails('abc123');
      expect(details).toContainEqual(
        '  FAILURE: ci/lint \u2192 https://ci.example.com/2',
      );
      // Successful statuses should not appear
      expect(details.join('\n')).not.toContain('ci/tests');
    });

    it('lists failed check runs with html_url', async () => {
      const github = getGitHubMock();
      github.repos.getCombinedStatusForRef.mockResolvedValue({
        data: {
          state: 'pending',
          total_count: 0,
          statuses: [],
        },
      });
      github.checks.listSuitesForRef.mockResolvedValue({
        data: { check_suites: [] },
      });
      github.checks.listForRef.mockResolvedValue({
        data: {
          total_count: 3,
          check_runs: [
            {
              name: 'build',
              status: 'completed',
              conclusion: 'success',
              html_url: 'https://github.com/runs/1',
            },
            {
              name: 'test-unit',
              status: 'completed',
              conclusion: 'failure',
              html_url: 'https://github.com/runs/2',
            },
            {
              name: 'test-integration',
              status: 'completed',
              conclusion: 'skipped',
              html_url: 'https://github.com/runs/3',
            },
          ],
        },
      });

      const status = await provider.getRevisionStatus('def456');
      expect(status).toBe(CommitStatus.FAILURE);

      const details = provider.getFailureDetails('def456');
      expect(details).toContainEqual(
        '  FAILURE: test-unit \u2192 https://github.com/runs/2',
      );
      // Successful and skipped runs should not appear
      expect(details.join('\n')).not.toContain('build');
      expect(details.join('\n')).not.toContain('test-integration');
    });

    it('includes both failed statuses and check runs', async () => {
      const github = getGitHubMock();
      github.repos.getCombinedStatusForRef.mockResolvedValue({
        data: {
          state: 'failure',
          total_count: 1,
          statuses: [
            {
              context: 'ci/deploy',
              state: 'error',
              target_url: 'https://ci.example.com/deploy/1',
            },
          ],
        },
      });
      github.checks.listSuitesForRef.mockResolvedValue({
        data: { check_suites: [] },
      });
      github.checks.listForRef.mockResolvedValue({
        data: {
          total_count: 1,
          check_runs: [
            {
              name: 'org-wide-policy',
              status: 'completed',
              conclusion: 'action_required',
              html_url: 'https://github.com/runs/99',
            },
          ],
        },
      });

      await provider.getRevisionStatus('rev789');
      const details = provider.getFailureDetails('rev789');

      expect(details).toContainEqual(
        '  ERROR: ci/deploy \u2192 https://ci.example.com/deploy/1',
      );
      expect(details).toContainEqual(
        '  ACTION_REQUIRED: org-wide-policy \u2192 https://github.com/runs/99',
      );
    });

    it('handles check runs without html_url', async () => {
      const github = getGitHubMock();
      github.repos.getCombinedStatusForRef.mockResolvedValue({
        data: {
          state: 'pending',
          total_count: 0,
          statuses: [],
        },
      });
      github.checks.listSuitesForRef.mockResolvedValue({
        data: { check_suites: [] },
      });
      github.checks.listForRef.mockResolvedValue({
        data: {
          total_count: 1,
          check_runs: [
            {
              name: 'some-check',
              status: 'completed',
              conclusion: 'failure',
              html_url: null,
            },
          ],
        },
      });

      await provider.getRevisionStatus('nourl');
      const details = provider.getFailureDetails('nourl');

      expect(details).toContainEqual('  FAILURE: some-check');
    });

    it('always includes the "See all checks" link', async () => {
      const github = getGitHubMock();
      github.repos.getCombinedStatusForRef.mockResolvedValue({
        data: { state: 'failure', total_count: 0, statuses: [] },
      });
      github.checks.listSuitesForRef.mockResolvedValue({
        data: { check_suites: [] },
      });
      github.checks.listForRef.mockResolvedValue({
        data: {
          total_count: 1,
          check_runs: [
            {
              name: 'failing',
              status: 'completed',
              conclusion: 'failure',
              html_url: 'https://github.com/runs/1',
            },
          ],
        },
      });

      await provider.getRevisionStatus('xyz');
      const details = provider.getFailureDetails('xyz');

      const lastDetail = details[details.length - 1];
      expect(lastDetail).toBe(
        '\nSee all checks: https://github.com/test-owner/test-repo/commit/xyz',
      );
    });

    it('handles legacy statuses without target_url', async () => {
      const github = getGitHubMock();
      github.repos.getCombinedStatusForRef.mockResolvedValue({
        data: {
          state: 'failure',
          total_count: 1,
          statuses: [
            {
              context: 'ci/no-link',
              state: 'failure',
              target_url: null,
            },
          ],
        },
      });
      github.checks.listSuitesForRef.mockResolvedValue({
        data: { check_suites: [] },
      });
      github.checks.listForRef.mockResolvedValue({
        data: { total_count: 0, check_runs: [] },
      });

      await provider.getRevisionStatus('nolink');
      const details = provider.getFailureDetails('nolink');

      expect(details).toContainEqual('  FAILURE: ci/no-link');
    });
  });
});
