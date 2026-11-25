import { vi, describe, it, expect, beforeEach } from 'vitest';

const repos = {
  getPages: vi.fn(),
  getLatestPagesBuild: vi.fn(),
  requestPagesBuild: vi.fn(),
  listDeployments: vi.fn(),
  listDeploymentStatuses: vi.fn(),
};

vi.mock('../../utils/githubApi', async () => {
  const actual = await vi.importActual<typeof import('../../utils/githubApi')>(
    '../../utils/githubApi',
  );
  return {
    ...actual,
    getGitHubClient: vi.fn(() => ({ repos })),
  };
});

vi.mock('../../utils/async', async () => {
  const actual =
    await vi.importActual<typeof import('../../utils/async')>(
      '../../utils/async',
    );
  return { ...actual, sleep: vi.fn().mockResolvedValue(undefined) };
});

import { GhPagesTarget } from '../ghPages';
import { NoneArtifactProvider } from '../../artifact_providers/none';
import { setGlobals } from '../../utils/helpers';

const SHA = 'a8b2579a0d9cebbfa5c58c2c4c2fc5ad66508645';

function build(id: number, status: string, commit = SHA, message?: string) {
  return {
    data: {
      url: `https://api.github.com/repos/o/r/pages/builds/${id}`,
      status,
      commit,
      error: { message: message ?? null },
    },
  };
}

function deploymentStatus(state: string) {
  return { data: [{ state }] };
}

function httpError(status: number) {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

describe('GhPagesTarget', () => {
  let target: GhPagesTarget;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GITHUB_TOKEN = 'test-token';
    setGlobals({ 'dry-run': false, 'log-level': 'Info', 'no-input': true });
    repos.getPages.mockResolvedValue({
      data: { build_type: 'legacy', source: { branch: 'gh-pages' } },
    });
    repos.listDeployments.mockResolvedValue({ data: [] });
    target = new GhPagesTarget(
      { name: 'gh-pages' },
      new NoneArtifactProvider(),
      { owner: 'o', repo: 'r' },
    );
  });

  describe('waitForPagesBuild', () => {
    it('returns when the build of the pushed commit is built', async () => {
      repos.getLatestPagesBuild
        .mockResolvedValueOnce(build(1, 'built', 'previous-sha'))
        .mockResolvedValueOnce(build(2, 'building'))
        .mockResolvedValueOnce(build(2, 'built'));

      await target.waitForPagesBuild(SHA);

      expect(repos.getLatestPagesBuild).toHaveBeenCalledTimes(3);
      expect(repos.requestPagesBuild).not.toHaveBeenCalled();
    });

    it('requests a rebuild when the build errors', async () => {
      repos.getLatestPagesBuild
        .mockResolvedValueOnce(build(2, 'errored', SHA, 'Page build failed.'))
        // The failed build stays the latest until the rebuild starts.
        .mockResolvedValueOnce(build(2, 'errored', SHA, 'Page build failed.'))
        .mockResolvedValueOnce(build(3, 'built'));

      await target.waitForPagesBuild(SHA);

      expect(repos.requestPagesBuild).toHaveBeenCalledTimes(1);
      expect(repos.requestPagesBuild).toHaveBeenCalledWith({
        owner: 'o',
        repo: 'r',
      });
    });

    it('does not rebuild when the errored build was still deployed', async () => {
      repos.getLatestPagesBuild.mockResolvedValueOnce(
        build(2, 'errored', SHA, 'Page build failed.'),
      );
      repos.listDeployments
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: [{ id: 7 }] });
      repos.listDeploymentStatuses
        .mockResolvedValueOnce(deploymentStatus('queued'))
        .mockResolvedValueOnce(deploymentStatus('in_progress'))
        .mockResolvedValueOnce(deploymentStatus('success'));

      await target.waitForPagesBuild(SHA);

      expect(repos.listDeployments).toHaveBeenCalledWith({
        owner: 'o',
        repo: 'r',
        sha: SHA,
        environment: 'github-pages',
        per_page: 1,
      });
      expect(repos.listDeploymentStatuses).toHaveBeenCalledWith({
        owner: 'o',
        repo: 'r',
        deployment_id: 7,
      });
      expect(repos.requestPagesBuild).not.toHaveBeenCalled();
    });

    it('accepts a deployment that succeeded before a newer one replaced it', async () => {
      repos.getLatestPagesBuild.mockResolvedValueOnce(build(2, 'errored'));
      repos.listDeployments.mockResolvedValue({ data: [{ id: 7 }] });
      repos.listDeploymentStatuses.mockResolvedValue({
        data: [{ state: 'inactive' }, { state: 'success' }],
      });

      await target.waitForPagesBuild(SHA);

      expect(repos.requestPagesBuild).not.toHaveBeenCalled();
    });

    it.each(['error', 'failure', 'inactive'])(
      'requests a rebuild when the deployment ends as %s',
      async state => {
        repos.getLatestPagesBuild
          .mockResolvedValueOnce(build(2, 'errored', SHA, 'Page build failed.'))
          .mockResolvedValueOnce(build(3, 'built'));
        repos.listDeployments.mockResolvedValue({ data: [{ id: 7 }] });
        repos.listDeploymentStatuses.mockResolvedValue(deploymentStatus(state));

        await target.waitForPagesBuild(SHA);

        expect(repos.listDeploymentStatuses).toHaveBeenCalledTimes(1);
        expect(repos.requestPagesBuild).toHaveBeenCalledTimes(1);
      },
    );

    it('stops looking for a deployment that does not show up', async () => {
      repos.getLatestPagesBuild
        .mockResolvedValueOnce(build(2, 'errored'))
        .mockResolvedValueOnce(build(3, 'built'));

      await target.waitForPagesBuild(SHA);

      expect(repos.listDeployments).toHaveBeenCalledTimes(6);
      expect(repos.requestPagesBuild).toHaveBeenCalledTimes(1);
    });

    it('waits for the deployment of a rebuild, not the failed one before it', async () => {
      repos.getLatestPagesBuild
        .mockResolvedValueOnce(build(2, 'errored'))
        .mockResolvedValueOnce(build(3, 'errored'));
      repos.listDeployments
        .mockResolvedValueOnce({ data: [{ id: 7 }] })
        // The rebuild's deployment does not exist yet.
        .mockResolvedValueOnce({ data: [{ id: 7 }] })
        .mockResolvedValueOnce({ data: [{ id: 8 }] });
      repos.listDeploymentStatuses
        .mockResolvedValueOnce(deploymentStatus('error'))
        .mockResolvedValueOnce(deploymentStatus('success'));

      await target.waitForPagesBuild(SHA);

      expect(repos.requestPagesBuild).toHaveBeenCalledTimes(1);
      expect(repos.listDeploymentStatuses).toHaveBeenLastCalledWith(
        expect.objectContaining({ deployment_id: 8 }),
      );
    });

    it.each([403, 404])(
      'requests a rebuild when deployments return %i',
      async status => {
        repos.getLatestPagesBuild
          .mockResolvedValueOnce(build(2, 'errored'))
          .mockResolvedValueOnce(build(3, 'built'));
        repos.listDeployments.mockRejectedValueOnce(httpError(status));
        const warn = vi.spyOn(target['logger'], 'warn');

        await target.waitForPagesBuild(SHA);

        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining(`deployments of o/r (HTTP ${status})`),
        );
        expect(repos.requestPagesBuild).toHaveBeenCalledTimes(1);
      },
    );

    it('names the missing permission when the rebuild request is rejected', async () => {
      repos.getLatestPagesBuild.mockResolvedValueOnce(
        build(2, 'errored', SHA, 'Page build failed.'),
      );
      repos.requestPagesBuild.mockRejectedValueOnce(httpError(403));

      await expect(target.waitForPagesBuild(SHA)).rejects.toThrow(
        /Cannot request a GitHub Pages rebuild of o\/r \(HTTP 403\): the token needs Pages write permission/,
      );
    });

    it('fails after the rebuilds also error', async () => {
      repos.getLatestPagesBuild
        .mockResolvedValueOnce(build(2, 'errored', SHA, 'Page build failed.'))
        .mockResolvedValueOnce(build(3, 'errored', SHA, 'Page build failed.'))
        .mockResolvedValueOnce(build(4, 'errored', SHA, 'Page build failed.'));

      await expect(target.waitForPagesBuild(SHA)).rejects.toThrow(
        /failed after 2 rebuilds \(Page build failed\.\).*o\/r\/deployments\/github-pages/,
      );
      expect(repos.requestPagesBuild).toHaveBeenCalledTimes(2);
    });

    it('treats a build that never finishes as failed', async () => {
      repos.getLatestPagesBuild.mockResolvedValue(build(2, 'building'));

      await expect(target.waitForPagesBuild(SHA)).rejects.toThrow(
        /failed after 2 rebuilds \(timed out\)/,
      );
      expect(repos.requestPagesBuild).toHaveBeenCalledTimes(2);
    });

    it.each([403, 404])(
      'warns and succeeds when Pages settings return %i',
      async status => {
        repos.getPages.mockRejectedValue(httpError(status));
        const warn = vi.spyOn(target['logger'], 'warn');

        await target.waitForPagesBuild(SHA);

        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining(`HTTP ${status}`),
        );
        expect(repos.getLatestPagesBuild).not.toHaveBeenCalled();
      },
    );

    it('does not wait when Pages builds from a workflow', async () => {
      repos.getPages.mockResolvedValue({
        data: { build_type: 'workflow', source: null },
      });

      await target.waitForPagesBuild(SHA);

      expect(repos.getLatestPagesBuild).not.toHaveBeenCalled();
    });
  });

  describe('publish', () => {
    it('does not wait for the Pages build in dry-run', async () => {
      setGlobals({ 'dry-run': true, 'log-level': 'Info', 'no-input': true });
      vi.spyOn(target, 'getArtifactsForRevision').mockResolvedValue([
        { filename: 'gh-pages.zip' } as any,
      ]);
      vi.spyOn(target.artifactProvider, 'downloadArtifact').mockResolvedValue(
        '/tmp/gh-pages.zip',
      );
      vi.spyOn(target, 'commitArchiveToBranch').mockResolvedValue(SHA);

      await target.publish('1.0.0', 'revision');

      expect(repos.getPages).not.toHaveBeenCalled();
    });

    it('waits for the Pages build of the pushed commit', async () => {
      vi.spyOn(target, 'getArtifactsForRevision').mockResolvedValue([
        { filename: 'gh-pages.zip' } as any,
      ]);
      vi.spyOn(target.artifactProvider, 'downloadArtifact').mockResolvedValue(
        '/tmp/gh-pages.zip',
      );
      vi.spyOn(target, 'commitArchiveToBranch').mockResolvedValue(SHA);
      repos.getLatestPagesBuild.mockResolvedValue(build(2, 'built'));

      await target.publish('1.0.0', 'revision');

      expect(repos.getLatestPagesBuild).toHaveBeenCalledTimes(1);
    });
  });
});
