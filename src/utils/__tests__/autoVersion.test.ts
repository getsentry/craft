/* eslint-env jest */

jest.mock('../githubApi.ts');
jest.mock('../git');
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  readFileSync: jest.fn(),
}));
jest.mock('../../config', () => ({
  ...jest.requireActual('../../config'),
  getConfigFileDir: jest.fn(),
  getGlobalGitHubConfig: jest.fn(),
}));

import { readFileSync } from 'fs';
import type { SimpleGit } from 'simple-git';

import * as config from '../../config';
import { getChangesSince } from '../git';
import { getGitHubClient } from '../githubApi';
import {
  BUMP_TYPES,
  analyzeCommitsForBump,
  calculateNextVersion,
  getAutoBumpType,
} from '../autoVersion';

const getConfigFileDirMock = config.getConfigFileDir as jest.MockedFunction<
  typeof config.getConfigFileDir
>;
const getGlobalGitHubConfigMock =
  config.getGlobalGitHubConfig as jest.MockedFunction<
    typeof config.getGlobalGitHubConfig
  >;
const readFileSyncMock = readFileSync as jest.MockedFunction<
  typeof readFileSync
>;
const getChangesSinceMock = getChangesSince as jest.MockedFunction<
  typeof getChangesSince
>;

describe('BUMP_TYPES', () => {
  test('ordered by priority: major > minor > patch', () => {
    expect(BUMP_TYPES).toEqual(['major', 'minor', 'patch']);
  });

  test('major has lowest index (highest priority)', () => {
    expect(BUMP_TYPES.indexOf('major')).toBe(0);
    expect(BUMP_TYPES.indexOf('minor')).toBe(1);
    expect(BUMP_TYPES.indexOf('patch')).toBe(2);
  });
});

describe('calculateNextVersion', () => {
  test('increments major version', () => {
    expect(calculateNextVersion('1.2.3', 'major')).toBe('2.0.0');
  });

  test('increments minor version', () => {
    expect(calculateNextVersion('1.2.3', 'minor')).toBe('1.3.0');
  });

  test('increments patch version', () => {
    expect(calculateNextVersion('1.2.3', 'patch')).toBe('1.2.4');
  });

  test('handles empty version as 0.0.0', () => {
    expect(calculateNextVersion('', 'patch')).toBe('0.0.1');
    expect(calculateNextVersion('', 'minor')).toBe('0.1.0');
    expect(calculateNextVersion('', 'major')).toBe('1.0.0');
  });

  test('handles prerelease versions', () => {
    // Semver patch on prerelease "releases" it (removes prerelease suffix)
    expect(calculateNextVersion('1.2.3-beta.1', 'patch')).toBe('1.2.3');
    // Minor bump on prerelease increments minor and removes prerelease
    expect(calculateNextVersion('1.2.3-rc.0', 'minor')).toBe('1.3.0');
  });
});

describe('analyzeCommitsForBump', () => {
  const mockGit = {} as SimpleGit;

  beforeEach(() => {
    jest.clearAllMocks();
    // Default: no release.yml file, use DEFAULT_RELEASE_CONFIG
    getConfigFileDirMock.mockReturnValue('/test/repo');
    readFileSyncMock.mockImplementation(() => {
      const error: NodeJS.ErrnoException = new Error('ENOENT');
      error.code = 'ENOENT';
      throw error;
    });
    getGlobalGitHubConfigMock.mockResolvedValue({
      owner: 'testowner',
      repo: 'testrepo',
    });
    (getGitHubClient as jest.Mock).mockReturnValue({
      graphql: jest.fn().mockResolvedValue({ repository: {} }),
    });
  });

  test('returns null bump type for no commits', async () => {
    getChangesSinceMock.mockResolvedValue([]);

    const result = await analyzeCommitsForBump(mockGit, 'v1.0.0');

    expect(result.bumpType).toBeNull();
    expect(result.totalCommits).toBe(0);
    expect(result.matchedCommits).toBe(0);
  });

  test('returns major bump for breaking changes', async () => {
    getChangesSinceMock.mockResolvedValue([
      { hash: 'abc123', title: 'feat!: breaking change', body: '', pr: null },
    ]);
    (getGitHubClient as jest.Mock).mockReturnValue({
      graphql: jest.fn().mockResolvedValue({
        repository: {
          Cabc123: {
            author: { user: { login: 'testuser' } },
            associatedPullRequests: { nodes: [] },
          },
        },
      }),
    });

    const result = await analyzeCommitsForBump(mockGit, 'v1.0.0');

    expect(result.bumpType).toBe('major');
    expect(result.matchedCommits).toBe(1);
  });

  test('returns major bump for breaking changes with scope', async () => {
    getChangesSinceMock.mockResolvedValue([
      {
        hash: 'abc123',
        title: 'fix(api)!: breaking fix',
        body: '',
        pr: null,
      },
    ]);
    (getGitHubClient as jest.Mock).mockReturnValue({
      graphql: jest.fn().mockResolvedValue({
        repository: {
          Cabc123: {
            author: { user: { login: 'testuser' } },
            associatedPullRequests: { nodes: [] },
          },
        },
      }),
    });

    const result = await analyzeCommitsForBump(mockGit, 'v1.0.0');

    expect(result.bumpType).toBe('major');
  });

  test('returns minor bump for features', async () => {
    getChangesSinceMock.mockResolvedValue([
      { hash: 'abc123', title: 'feat: new feature', body: '', pr: null },
    ]);
    (getGitHubClient as jest.Mock).mockReturnValue({
      graphql: jest.fn().mockResolvedValue({
        repository: {
          Cabc123: {
            author: { user: { login: 'testuser' } },
            associatedPullRequests: { nodes: [] },
          },
        },
      }),
    });

    const result = await analyzeCommitsForBump(mockGit, 'v1.0.0');

    expect(result.bumpType).toBe('minor');
  });

  test('returns patch bump for fixes', async () => {
    getChangesSinceMock.mockResolvedValue([
      { hash: 'abc123', title: 'fix: bug fix', body: '', pr: null },
    ]);
    (getGitHubClient as jest.Mock).mockReturnValue({
      graphql: jest.fn().mockResolvedValue({
        repository: {
          Cabc123: {
            author: { user: { login: 'testuser' } },
            associatedPullRequests: { nodes: [] },
          },
        },
      }),
    });

    const result = await analyzeCommitsForBump(mockGit, 'v1.0.0');

    expect(result.bumpType).toBe('patch');
  });

  test('returns patch bump for docs', async () => {
    getChangesSinceMock.mockResolvedValue([
      { hash: 'abc123', title: 'docs: update readme', body: '', pr: null },
    ]);
    (getGitHubClient as jest.Mock).mockReturnValue({
      graphql: jest.fn().mockResolvedValue({
        repository: {
          Cabc123: {
            author: { user: { login: 'testuser' } },
            associatedPullRequests: { nodes: [] },
          },
        },
      }),
    });

    const result = await analyzeCommitsForBump(mockGit, 'v1.0.0');

    expect(result.bumpType).toBe('patch');
  });

  test('returns patch bump for chore', async () => {
    getChangesSinceMock.mockResolvedValue([
      { hash: 'abc123', title: 'chore: cleanup', body: '', pr: null },
    ]);
    (getGitHubClient as jest.Mock).mockReturnValue({
      graphql: jest.fn().mockResolvedValue({
        repository: {
          Cabc123: {
            author: { user: { login: 'testuser' } },
            associatedPullRequests: { nodes: [] },
          },
        },
      }),
    });

    const result = await analyzeCommitsForBump(mockGit, 'v1.0.0');

    expect(result.bumpType).toBe('patch');
  });

  test('returns highest bump type when mixed commits (major wins)', async () => {
    getChangesSinceMock.mockResolvedValue([
      { hash: 'abc123', title: 'fix: bug fix', body: '', pr: null },
      { hash: 'def456', title: 'feat: new feature', body: '', pr: null },
      { hash: 'ghi789', title: 'feat!: breaking change', body: '', pr: null },
    ]);
    (getGitHubClient as jest.Mock).mockReturnValue({
      graphql: jest.fn().mockResolvedValue({
        repository: {
          Cabc123: {
            author: { user: { login: 'testuser' } },
            associatedPullRequests: { nodes: [] },
          },
          Cdef456: {
            author: { user: { login: 'testuser' } },
            associatedPullRequests: { nodes: [] },
          },
          Cghi789: {
            author: { user: { login: 'testuser' } },
            associatedPullRequests: { nodes: [] },
          },
        },
      }),
    });

    const result = await analyzeCommitsForBump(mockGit, 'v1.0.0');

    expect(result.bumpType).toBe('major');
  });

  test('returns minor when no major but has features', async () => {
    getChangesSinceMock.mockResolvedValue([
      { hash: 'abc123', title: 'fix: bug fix', body: '', pr: null },
      { hash: 'def456', title: 'feat: new feature', body: '', pr: null },
      { hash: 'ghi789', title: 'docs: update docs', body: '', pr: null },
    ]);
    (getGitHubClient as jest.Mock).mockReturnValue({
      graphql: jest.fn().mockResolvedValue({
        repository: {
          Cabc123: {
            author: { user: { login: 'testuser' } },
            associatedPullRequests: { nodes: [] },
          },
          Cdef456: {
            author: { user: { login: 'testuser' } },
            associatedPullRequests: { nodes: [] },
          },
          Cghi789: {
            author: { user: { login: 'testuser' } },
            associatedPullRequests: { nodes: [] },
          },
        },
      }),
    });

    const result = await analyzeCommitsForBump(mockGit, 'v1.0.0');

    expect(result.bumpType).toBe('minor');
  });

  test('skips commits with skip-changelog magic word', async () => {
    getChangesSinceMock.mockResolvedValue([
      {
        hash: 'abc123',
        title: 'feat!: breaking change',
        body: '#skip-changelog',
        pr: null,
      },
      { hash: 'def456', title: 'fix: bug fix', body: '', pr: null },
    ]);
    (getGitHubClient as jest.Mock).mockReturnValue({
      graphql: jest.fn().mockResolvedValue({
        repository: {
          Cdef456: {
            author: { user: { login: 'testuser' } },
            associatedPullRequests: { nodes: [] },
          },
        },
      }),
    });

    const result = await analyzeCommitsForBump(mockGit, 'v1.0.0');

    // Should be patch because the major commit was skipped
    expect(result.bumpType).toBe('patch');
    expect(result.totalCommits).toBe(1);
  });

  test('returns null bump type when no commits match categories with semver', async () => {
    getChangesSinceMock.mockResolvedValue([
      {
        hash: 'abc123',
        title: 'random commit without conventional format',
        body: '',
        pr: null,
      },
    ]);
    (getGitHubClient as jest.Mock).mockReturnValue({
      graphql: jest.fn().mockResolvedValue({
        repository: {
          Cabc123: {
            author: { user: { login: 'testuser' } },
            associatedPullRequests: { nodes: [] },
          },
        },
      }),
    });

    const result = await analyzeCommitsForBump(mockGit, 'v1.0.0');

    expect(result.bumpType).toBeNull();
    expect(result.totalCommits).toBe(1);
    expect(result.matchedCommits).toBe(0);
  });

  test('early exits when major bump is found', async () => {
    // Put major commit first, followed by many others
    const commits = [
      { hash: 'abc123', title: 'feat!: breaking change', body: '', pr: null },
      ...Array.from({ length: 100 }, (_, i) => ({
        hash: `hash${i}`,
        title: 'fix: bug fix',
        body: '',
        pr: null,
      })),
    ];
    getChangesSinceMock.mockResolvedValue(commits);

    const graphqlMock = jest.fn().mockResolvedValue({
      repository: {
        Cabc123: {
          author: { user: { login: 'testuser' } },
          associatedPullRequests: { nodes: [] },
        },
        // Only add the first commit's data - if early exit works, others won't be needed
      },
    });
    (getGitHubClient as jest.Mock).mockReturnValue({ graphql: graphqlMock });

    const result = await analyzeCommitsForBump(mockGit, 'v1.0.0');

    expect(result.bumpType).toBe('major');
    // Due to early exit, matchedCommits should be 1 (just the major)
    expect(result.matchedCommits).toBe(1);
  });

  test('uses custom release config semver values', async () => {
    // Mock a custom release.yml with different semver mappings
    readFileSyncMock.mockReturnValue(`
changelog:
  categories:
    - title: 'Custom Breaking'
      commit_patterns:
        - '^BREAKING:'
      semver: major
    - title: 'Custom Feature'
      commit_patterns:
        - '^FEATURE:'
      semver: minor
`);

    getChangesSinceMock.mockResolvedValue([
      { hash: 'abc123', title: 'FEATURE: custom feature', body: '', pr: null },
    ]);
    (getGitHubClient as jest.Mock).mockReturnValue({
      graphql: jest.fn().mockResolvedValue({
        repository: {
          Cabc123: {
            author: { user: { login: 'testuser' } },
            associatedPullRequests: { nodes: [] },
          },
        },
      }),
    });

    const result = await analyzeCommitsForBump(mockGit, 'v1.0.0');

    expect(result.bumpType).toBe('minor');
  });

  test('returns null for categories without semver field', async () => {
    // Mock a release.yml with no semver fields
    readFileSyncMock.mockReturnValue(`
changelog:
  categories:
    - title: 'Features'
      commit_patterns:
        - '^feat:'
`);

    getChangesSinceMock.mockResolvedValue([
      { hash: 'abc123', title: 'feat: new feature', body: '', pr: null },
    ]);
    (getGitHubClient as jest.Mock).mockReturnValue({
      graphql: jest.fn().mockResolvedValue({
        repository: {
          Cabc123: {
            author: { user: { login: 'testuser' } },
            associatedPullRequests: { nodes: [] },
          },
        },
      }),
    });

    const result = await analyzeCommitsForBump(mockGit, 'v1.0.0');

    // Category matched but no semver field, so null
    expect(result.bumpType).toBeNull();
    expect(result.totalCommits).toBe(1);
    expect(result.matchedCommits).toBe(0);
  });
});

describe('getAutoBumpType', () => {
  const mockGit = {} as SimpleGit;

  beforeEach(() => {
    jest.clearAllMocks();
    getConfigFileDirMock.mockReturnValue('/test/repo');
    readFileSyncMock.mockImplementation(() => {
      const error: NodeJS.ErrnoException = new Error('ENOENT');
      error.code = 'ENOENT';
      throw error;
    });
    getGlobalGitHubConfigMock.mockResolvedValue({
      owner: 'testowner',
      repo: 'testrepo',
    });
  });

  test('returns minor bump type for feature commits', async () => {
    getChangesSinceMock.mockResolvedValue([
      { hash: 'abc123', title: 'feat: new feature', body: '', pr: null },
    ]);
    (getGitHubClient as jest.Mock).mockReturnValue({
      graphql: jest.fn().mockResolvedValue({
        repository: {
          Cabc123: {
            author: { user: { login: 'testuser' } },
            associatedPullRequests: { nodes: [] },
          },
        },
      }),
    });

    const bumpType = await getAutoBumpType(mockGit, 'v1.0.0');

    expect(bumpType).toBe('minor');
  });

  test('throws error when no commits found', async () => {
    getChangesSinceMock.mockResolvedValue([]);

    await expect(getAutoBumpType(mockGit, 'v1.0.0')).rejects.toThrow(
      'Cannot determine version automatically: no commits found since the last release.'
    );
  });

  test('throws error when no commits match semver categories', async () => {
    getChangesSinceMock.mockResolvedValue([
      {
        hash: 'abc123',
        title: 'random commit without conventional format',
        body: '',
        pr: null,
      },
    ]);
    (getGitHubClient as jest.Mock).mockReturnValue({
      graphql: jest.fn().mockResolvedValue({
        repository: {
          Cabc123: {
            author: { user: { login: 'testuser' } },
            associatedPullRequests: { nodes: [] },
          },
        },
      }),
    });

    await expect(getAutoBumpType(mockGit, 'v1.0.0')).rejects.toThrow(
      'Cannot determine version automatically'
    );
  });

  test('returns patch bump type for fix commits', async () => {
    getChangesSinceMock.mockResolvedValue([
      { hash: 'abc123', title: 'fix: bug fix', body: '', pr: null },
    ]);
    (getGitHubClient as jest.Mock).mockReturnValue({
      graphql: jest.fn().mockResolvedValue({
        repository: {
          Cabc123: {
            author: { user: { login: 'testuser' } },
            associatedPullRequests: { nodes: [] },
          },
        },
      }),
    });

    const bumpType = await getAutoBumpType(mockGit, 'v2.0.0');

    expect(bumpType).toBe('patch');
  });

  test('returns major bump type for breaking changes', async () => {
    getChangesSinceMock.mockResolvedValue([
      { hash: 'abc123', title: 'feat!: breaking change', body: '', pr: null },
    ]);
    (getGitHubClient as jest.Mock).mockReturnValue({
      graphql: jest.fn().mockResolvedValue({
        repository: {
          Cabc123: {
            author: { user: { login: 'testuser' } },
            associatedPullRequests: { nodes: [] },
          },
        },
      }),
    });

    const bumpType = await getAutoBumpType(mockGit, '');

    expect(bumpType).toBe('major');
  });
});
