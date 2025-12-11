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
  calculateNextVersion,
  getChangelogWithBumpType,
  validateBumpType,
} from '../autoVersion';
import { clearChangesetCache } from '../changelog';

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

describe('validateBumpType', () => {
  test('throws error when no commits found', () => {
    const result = {
      changelog: '',
      bumpType: null,
      totalCommits: 0,
      matchedCommitsWithSemver: 0,
    };

    expect(() => validateBumpType(result)).toThrow(
      'Cannot determine version automatically: no commits found since the last release.'
    );
  });

  test('throws error when no commits match semver categories', () => {
    const result = {
      changelog: '',
      bumpType: null,
      totalCommits: 5,
      matchedCommitsWithSemver: 0,
    };

    expect(() => validateBumpType(result)).toThrow(
      'Cannot determine version automatically'
    );
  });

  test('does not throw when bumpType is present', () => {
    const result = {
      changelog: '### Features\n- feat: new feature',
      bumpType: 'minor' as const,
      totalCommits: 1,
      matchedCommitsWithSemver: 1,
    };

    expect(() => validateBumpType(result)).not.toThrow();
  });
});

describe('getChangelogWithBumpType', () => {
  const mockGit = {} as SimpleGit;

  beforeEach(() => {
    jest.clearAllMocks();
    clearChangesetCache(); // Clear memoization cache between tests
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

  test('returns changelog and minor bump type for feature commits', async () => {
    getChangesSinceMock.mockResolvedValue([
      { hash: 'abc123', title: 'feat: new feature', body: '', pr: '123' },
    ]);
    (getGitHubClient as jest.Mock).mockReturnValue({
      graphql: jest.fn().mockResolvedValue({
        repository: {
          Cabc123: {
            author: { user: { login: 'testuser' } },
            associatedPullRequests: {
              nodes: [
                {
                  number: '123',
                  title: 'feat: new feature',
                  body: '',
                  labels: { nodes: [] },
                },
              ],
            },
          },
        },
      }),
    });

    const result = await getChangelogWithBumpType(mockGit, 'v1.0.0');

    expect(result.bumpType).toBe('minor');
    expect(result.changelog).toBeDefined();
    expect(result.totalCommits).toBe(1);
  });

  test('returns null bumpType when no commits found', async () => {
    getChangesSinceMock.mockResolvedValue([]);

    const result = await getChangelogWithBumpType(mockGit, 'v1.0.0');

    expect(result.bumpType).toBeNull();
    expect(result.totalCommits).toBe(0);
  });

  test('returns null bumpType when no commits match semver categories', async () => {
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

    const result = await getChangelogWithBumpType(mockGit, 'v1.0.0');

    expect(result.bumpType).toBeNull();
    expect(result.totalCommits).toBe(1);
    expect(result.matchedCommitsWithSemver).toBe(0);
  });

  test('returns patch bump type for fix commits', async () => {
    getChangesSinceMock.mockResolvedValue([
      { hash: 'abc123', title: 'fix: bug fix', body: '', pr: '456' },
    ]);
    (getGitHubClient as jest.Mock).mockReturnValue({
      graphql: jest.fn().mockResolvedValue({
        repository: {
          Cabc123: {
            author: { user: { login: 'testuser' } },
            associatedPullRequests: {
              nodes: [
                {
                  number: '456',
                  title: 'fix: bug fix',
                  body: '',
                  labels: { nodes: [] },
                },
              ],
            },
          },
        },
      }),
    });

    const result = await getChangelogWithBumpType(mockGit, 'v2.0.0');

    expect(result.bumpType).toBe('patch');
  });

  test('returns major bump type for breaking changes', async () => {
    getChangesSinceMock.mockResolvedValue([
      { hash: 'abc123', title: 'feat!: breaking change', body: '', pr: '789' },
    ]);
    (getGitHubClient as jest.Mock).mockReturnValue({
      graphql: jest.fn().mockResolvedValue({
        repository: {
          Cabc123: {
            author: { user: { login: 'testuser' } },
            associatedPullRequests: {
              nodes: [
                {
                  number: '789',
                  title: 'feat!: breaking change',
                  body: '',
                  labels: { nodes: [] },
                },
              ],
            },
          },
        },
      }),
    });

    const result = await getChangelogWithBumpType(mockGit, '');

    expect(result.bumpType).toBe('major');
  });
});
