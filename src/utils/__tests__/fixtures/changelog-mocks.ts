/**
 * Shared mock setup for changelog tests.
 */
import type { SimpleGit } from 'simple-git';
import type { TestCommit } from './changelog';

// Re-export for convenience
export type { TestCommit } from './changelog';

// These will be set up by the test files that import this
export let mockClient: jest.Mock;
export let mockGetChangesSince: jest.MockedFunction<any>;
export let getConfigFileDirMock: jest.MockedFunction<any>;
export let getGlobalGitHubConfigMock: jest.MockedFunction<any>;
export let readFileSyncMock: jest.MockedFunction<any>;

export const dummyGit = {} as SimpleGit;

/**
 * Initialize mocks - call this in beforeEach of test files that need GitHub mocking.
 */
export function initMocks(
  getGitHubClient: any,
  getChangesSince: any,
  config: any,
  readFileSync: any,
  clearChangesetCache: () => void
): void {
  mockClient = jest.fn();
  mockGetChangesSince = getChangesSince as jest.MockedFunction<typeof getChangesSince>;
  getConfigFileDirMock = config.getConfigFileDir as jest.MockedFunction<typeof config.getConfigFileDir>;
  getGlobalGitHubConfigMock = config.getGlobalGitHubConfig as jest.MockedFunction<typeof config.getGlobalGitHubConfig>;
  readFileSyncMock = readFileSync as jest.MockedFunction<typeof readFileSync>;

  jest.resetAllMocks();
  clearChangesetCache();

  (getGitHubClient as jest.MockedFunction<typeof getGitHubClient>).mockReturnValue({
    graphql: mockClient,
  } as any);

  getConfigFileDirMock.mockReturnValue(undefined);
  getGlobalGitHubConfigMock.mockResolvedValue({
    repo: 'test-repo',
    owner: 'test-owner',
  });
  readFileSyncMock.mockImplementation(() => {
    const error: any = new Error('ENOENT');
    error.code = 'ENOENT';
    throw error;
  });
}

/**
 * Setup function for generateChangesetFromGit tests.
 * Configures mocks for a specific test scenario.
 */
export function setupGenerateTest(
  commits: TestCommit[],
  releaseConfig?: string | null
): void {
  mockGetChangesSince.mockResolvedValueOnce(
    commits.map(commit => ({
      hash: commit.hash,
      title: commit.title,
      body: commit.body,
      pr: commit.pr?.local || null,
    }))
  );

  mockClient.mockResolvedValueOnce({
    repository: Object.fromEntries(
      commits.map(({ hash, author, title, pr }: TestCommit) => [
        `C${hash}`,
        {
          author: { user: author },
          associatedPullRequests: {
            nodes: pr?.remote
              ? [
                  {
                    author: pr.remote.author,
                    number: pr.remote.number,
                    title: pr.remote.title ?? title,
                    body: pr.remote.body || '',
                    labels: {
                      nodes: (pr.remote.labels || []).map(label => ({
                        name: label,
                      })),
                    },
                  },
                ]
              : [],
          },
        },
      ])
    ),
  });

  if (releaseConfig !== undefined) {
    if (releaseConfig === null) {
      getConfigFileDirMock.mockReturnValue(undefined);
      readFileSyncMock.mockImplementation(() => {
        const error: any = new Error('ENOENT');
        error.code = 'ENOENT';
        throw error;
      });
    } else {
      getConfigFileDirMock.mockReturnValue('/workspace');
      readFileSyncMock.mockImplementation((path: any) => {
        if (typeof path === 'string' && path.includes('.github/release.yml')) {
          return releaseConfig;
        }
        const error: any = new Error('ENOENT');
        error.code = 'ENOENT';
        throw error;
      });
    }
  }
}

