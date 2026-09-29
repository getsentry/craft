import { captureException } from '@sentry/node';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join as pathJoin } from 'path';
import type { SimpleGit } from 'simple-git';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
  type Mock,
} from 'vitest';

import {
  expandWorkspaceTargets,
  getActiveWorkspace,
  getArtifactProviderFromConfig,
  getConfiguration,
  getGlobalGitHubConfig,
  getNoMergeConfig,
  getStatusProviderFromConfig,
} from '../../config';
import { logger } from '../../logger';
import { getTargetByName } from '../../targets';
import { BaseTarget } from '../../targets/base';
import { safeFs } from '../../utils/dryRun';
import { promptConfirmation } from '../../utils/helpers';
import { getPublishStatePath } from '../../utils/publishState';
import {
  findReleaseBranches,
  getDefaultBranch,
  getGitClient,
  isRepoDirty,
} from '../../utils/git';
import { BranchCleanupError, publishMain } from '../publish';

vi.mock('@sentry/node', () => ({
  captureException: vi.fn(),
  startSpan: vi.fn((_options: unknown, callback: () => unknown): unknown =>
    callback(),
  ),
}));
vi.mock('../../config', async importOriginal => ({
  ...(await importOriginal<typeof import('../../config')>()),
  expandWorkspaceTargets: vi.fn(),
  getActiveWorkspace: vi.fn(),
  getArtifactProviderFromConfig: vi.fn(),
  getConfiguration: vi.fn(),
  getGlobalGitHubConfig: vi.fn(),
  getNoMergeConfig: vi.fn(),
  getStatusProviderFromConfig: vi.fn(),
}));
vi.mock('../../utils/git', () => ({
  findReleaseBranches: vi.fn(),
  getDefaultBranch: vi.fn(),
  getGitClient: vi.fn(),
  isRepoDirty: vi.fn(),
}));
vi.mock('../../targets', async importOriginal => ({
  ...(await importOriginal<typeof import('../../targets')>()),
  getTargetByName: vi.fn(),
}));
vi.mock('../../utils/helpers', async importOriginal => ({
  ...(await importOriginal<typeof import('../../utils/helpers')>()),
  promptConfirmation: vi.fn(),
}));
vi.mock('../../utils/publishState', async importOriginal => ({
  ...(await importOriginal<typeof import('../../utils/publishState')>()),
  getPublishStatePath: vi.fn(),
}));

function createMockGit(revision: string): SimpleGit {
  return {
    branch: vi.fn().mockResolvedValue(undefined),
    branchLocal: vi.fn().mockResolvedValue({ all: [] }),
    checkout: vi.fn().mockResolvedValue(undefined),
    merge: vi.fn().mockResolvedValue(undefined),
    pull: vi.fn().mockResolvedValue(undefined),
    push: vi.fn().mockResolvedValue(undefined),
    raw: vi.fn().mockResolvedValue(''),
    revparse: vi.fn().mockResolvedValue(revision),
    status: vi.fn().mockResolvedValue({ files: [] }),
  } as unknown as SimpleGit;
}

const defaultOptions = {
  remote: 'origin',
  mergeTarget: 'main',
  target: 'all',
  newVersion: '1.2.3',
  noMerge: false,
  keepDownloads: false,
  noStatusCheck: true,
  keepBranch: false,
  noGitChecks: true,
};

const publishTarget = vi.fn();
const testState = { directory: '' };

class TestTarget extends BaseTarget {
  public override publish(version: string, revision: string): Promise<void> {
    return publishTarget(version, revision);
  }
}

describe('publishMain release branch handling', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    testState.directory = await mkdtemp(
      pathJoin(tmpdir(), 'craft-publish-main-'),
    );
    vi.mocked(getPublishStatePath).mockReturnValue(
      pathJoin(testState.directory, 'publish-state.json'),
    );
    vi.mocked(getConfiguration).mockReturnValue({
      releaseBranchPrefix: 'stable',
      targets: [{ name: 'test' }],
      postReleaseCommand: '',
    });
    vi.mocked(getStatusProviderFromConfig).mockResolvedValue({} as never);
    vi.mocked(getArtifactProviderFromConfig).mockResolvedValue({
      listArtifactsForRevision: vi.fn().mockResolvedValue([]),
      setDownloadDirectory: vi.fn(),
    } as never);
    vi.mocked(getGlobalGitHubConfig).mockResolvedValue({
      owner: 'getsentry',
      repo: 'craft',
    });
    vi.mocked(expandWorkspaceTargets).mockResolvedValue([{ name: 'test' }]);
    vi.mocked(getTargetByName).mockReturnValue(TestTarget);
    vi.mocked(promptConfirmation).mockResolvedValue(undefined);
    vi.mocked(getNoMergeConfig).mockReturnValue({
      noMerge: false,
      source: 'config',
    });
    vi.mocked(getActiveWorkspace).mockReturnValue(undefined);
    vi.mocked(isRepoDirty).mockReturnValue(false);
    vi.mocked(findReleaseBranches).mockResolvedValue({
      exactMatches: [],
      fuzzyMatches: [],
    });
    vi.mocked(getDefaultBranch).mockResolvedValue('main');
    vi.spyOn(safeFs, 'unlink').mockResolvedValue(undefined);
    vi.spyOn(safeFs, 'writeFileSync').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(testState.directory, { recursive: true, force: true });
  });

  test('publishes and merges an approved revision while deleting the canonical branch', async () => {
    const requestedRevision = 'v1.2.3';
    const approvedRevision = 'a'.repeat(40);
    const git = createMockGit(approvedRevision);
    (git.raw as Mock).mockImplementation((...args: string[]) =>
      Promise.resolve(
        args[0] === 'name-rev' ? 'remotes/origin/stable/1.2.3\n' : '',
      ),
    );
    vi.mocked(getGitClient).mockResolvedValue(git);

    await publishMain({ ...defaultOptions, rev: requestedRevision });

    expect(git.checkout).toHaveBeenNthCalledWith(1, requestedRevision);
    expect(publishTarget).toHaveBeenCalledWith('1.2.3', approvedRevision);
    expect(git.raw).not.toHaveBeenCalledWith(
      'name-rev',
      '--name-only',
      '--no-undefined',
      requestedRevision,
    );
    expect(git.merge).toHaveBeenCalledWith([
      '--no-ff',
      '--no-edit',
      approvedRevision,
    ]);
    expect(git.push).toHaveBeenCalledWith(
      'origin',
      ':refs/heads/stable/1.2.3',
      [`--force-with-lease=refs/heads/stable/1.2.3:${approvedRevision}`],
    );
    expect(git.branch).not.toHaveBeenCalled();
  });

  test('keeps the ordinary release branch checkout and merge path', async () => {
    const revision = 'b'.repeat(40);
    const git = createMockGit(revision);
    vi.mocked(getGitClient).mockResolvedValue(git);

    await publishMain(defaultOptions);

    expect(git.checkout).toHaveBeenNthCalledWith(1, 'stable/1.2.3');
    expect(publishTarget).toHaveBeenCalledWith('1.2.3', revision);
    expect(git.merge).toHaveBeenCalledWith([
      '--no-ff',
      '--no-edit',
      'stable/1.2.3',
    ]);
    expect(git.push).toHaveBeenCalledWith(
      'origin',
      ':refs/heads/stable/1.2.3',
      [`--force-with-lease=refs/heads/stable/1.2.3:${revision}`],
    );
  });

  test('reports remote deletion failures as cleanup failures', async () => {
    const requestedRevision = 'release-candidate';
    const approvedRevision = 'c'.repeat(40);
    const git = createMockGit(approvedRevision);
    vi.mocked(git.push)
      .mockResolvedValueOnce({} as never)
      .mockRejectedValueOnce(new Error('remote delete failed'));
    vi.mocked(getGitClient).mockResolvedValue(git);
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    await publishMain({ ...defaultOptions, rev: requestedRevision });

    expect(captureException).toHaveBeenCalledWith(
      expect.any(BranchCleanupError),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to clean up release branch'),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        `--force-with-lease=refs/heads/stable/1.2.3:${approvedRevision}`,
      ),
    );
    expect(warn).not.toHaveBeenCalledWith(
      expect.stringContaining('Failed to merge release branch'),
    );
  });
});
