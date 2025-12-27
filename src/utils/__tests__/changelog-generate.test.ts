/**
 * Tests for generateChangesetFromGit - the main changelog generation function.
 * Uses snapshot testing for output validation to reduce test file size.
 */

/* eslint-env jest */

jest.mock('../githubApi.ts');
import { getGitHubClient } from '../githubApi';
jest.mock('../git');
import { getChangesSince } from '../git';
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  readFileSync: jest.fn(),
}));
jest.mock('../../config', () => ({
  ...jest.requireActual('../../config'),
  getConfigFileDir: jest.fn(),
  getGlobalGitHubConfig: jest.fn(),
}));
import * as config from '../../config';
import { readFileSync } from 'fs';
import type { SimpleGit } from 'simple-git';

import { generateChangesetFromGit, clearChangesetCache } from '../changelog';
import { type TestCommit } from './fixtures/changelog';

const getConfigFileDirMock = config.getConfigFileDir as jest.MockedFunction<typeof config.getConfigFileDir>;
const getGlobalGitHubConfigMock = config.getGlobalGitHubConfig as jest.MockedFunction<typeof config.getGlobalGitHubConfig>;
const readFileSyncMock = readFileSync as jest.MockedFunction<typeof readFileSync>;

describe('generateChangesetFromGit', () => {
  let mockClient: jest.Mock;
  const mockGetChangesSince = getChangesSince as jest.MockedFunction<typeof getChangesSince>;
  const dummyGit = {} as SimpleGit;

  beforeEach(() => {
    jest.resetAllMocks();
    clearChangesetCache();
    mockClient = jest.fn();
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
  });

  function setup(commits: TestCommit[], releaseConfig?: string | null): void {
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

  // ============================================================================
  // Basic output formatting tests - use snapshots
  // ============================================================================

  describe('output formatting', () => {
    it('returns empty string for empty changeset', async () => {
      setup([], null);
      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 3);
      expect(result.changelog).toBe('');
    });

    it('formats local commit with short SHA', async () => {
      setup([{ hash: 'abcdef1234567890', title: 'Upgraded the kernel', body: '' }], null);
      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 3);
      expect(result.changelog).toMatchSnapshot();
    });

    it('uses PR number when available locally', async () => {
      setup([
        { hash: 'abcdef1234567890', title: 'Upgraded the kernel (#123)', body: '', pr: { local: '123' } },
      ], null);
      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 3);
      expect(result.changelog).toMatchSnapshot();
    });

    it('uses PR number and author from remote', async () => {
      setup([
        {
          hash: 'abcdef1234567890',
          title: 'Upgraded the kernel',
          body: '',
          pr: { remote: { number: '123', author: { login: 'sentry' } } },
        },
      ], null);
      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 3);
      expect(result.changelog).toMatchSnapshot();
    });

    it('handles null PR author gracefully', async () => {
      setup([
        { hash: 'abcdef1234567890', title: 'Upgraded the kernel', body: '', pr: { remote: { number: '123' } } },
      ], null);
      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 3);
      expect(result.changelog).toMatchSnapshot();
    });

    it('uses PR title from GitHub instead of commit message', async () => {
      setup([
        {
          hash: 'abcdef1234567890',
          title: 'fix: quick fix for issue',
          body: '',
          pr: {
            remote: {
              number: '123',
              title: 'feat: A much better PR title with more context',
              author: { login: 'sentry' },
            },
          },
        },
      ], null);
      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 3);
      expect(result.changelog).toMatchSnapshot();
    });

    it('handles multiple commits', async () => {
      setup([
        { hash: 'abcdef1234567890', title: 'Upgraded the kernel', body: '' },
        {
          hash: 'bcdef1234567890a',
          title: 'Upgraded the manifold (#123)',
          body: '',
          pr: { local: '123', remote: { number: '123', author: { login: 'alice' } } },
        },
        {
          hash: 'cdef1234567890ab',
          title: 'Refactored the crankshaft',
          body: '',
          pr: { remote: { number: '456', author: { login: 'bob' } } },
        },
        {
          hash: 'cdef1234567890ad',
          title: 'Refactored the crankshaft again',
          body: '',
          pr: { remote: { number: '458', author: { login: 'bob' } } },
        },
      ], null);
      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 3);
      expect(result.changelog).toMatchSnapshot();
    });

    it('escapes underscores in titles', async () => {
      setup([
        {
          hash: 'abcdef1234567890',
          title: 'Serialized _meta',
          body: '',
          pr: { remote: { number: '123' } },
        },
      ], null);
      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 3);
      expect(result.changelog).toMatchSnapshot();
    });
  });

  // ============================================================================
  // Category matching tests
  // ============================================================================

  describe('category matching', () => {
    const BASIC_CONFIG = `
changelog:
  categories:
    - title: Features
      labels:
        - enhancement
    - title: Bug Fixes
      labels:
        - bug
`;

    it('matches PRs to categories based on labels', async () => {
      setup([
        {
          hash: 'abc123',
          title: 'Feature PR',
          body: '',
          pr: { local: '1', remote: { number: '1', author: { login: 'alice' }, labels: ['enhancement'] } },
        },
        {
          hash: 'def456',
          title: 'Bug fix PR',
          body: '',
          pr: { local: '2', remote: { number: '2', author: { login: 'bob' }, labels: ['bug'] } },
        },
      ], BASIC_CONFIG);
      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 3);
      expect(result.changelog).toMatchSnapshot();
    });

    it('applies global exclusions', async () => {
      const configWithExclusions = `
changelog:
  exclude:
    labels:
      - skip-changelog
    authors:
      - dependabot
  categories:
    - title: Features
      labels:
        - enhancement
`;
      setup([
        {
          hash: 'abc123',
          title: 'Normal feature',
          body: '',
          pr: { local: '1', remote: { number: '1', author: { login: 'alice' }, labels: ['enhancement'] } },
        },
        {
          hash: 'def456',
          title: 'Should be excluded by label',
          body: '',
          pr: { local: '2', remote: { number: '2', author: { login: 'bob' }, labels: ['enhancement', 'skip-changelog'] } },
        },
        {
          hash: 'ghi789',
          title: 'Should be excluded by author',
          body: '',
          pr: { local: '3', remote: { number: '3', author: { login: 'dependabot' }, labels: ['enhancement'] } },
        },
      ], configWithExclusions);
      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 10);
      expect(result.changelog).toMatchSnapshot();
    });

    it('supports wildcard category matching', async () => {
      const wildcardConfig = `
changelog:
  categories:
    - title: Changes
      labels:
        - "*"
`;
      setup([
        {
          hash: 'abc123',
          title: 'Any PR',
          body: '',
          pr: { local: '1', remote: { number: '1', author: { login: 'alice' }, labels: ['random-label'] } },
        },
      ], wildcardConfig);
      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 3);
      expect(result.changelog).toMatchSnapshot();
    });
  });

  // ============================================================================
  // Commit patterns matching tests
  // ============================================================================

  describe('commit patterns', () => {
    const PATTERN_CONFIG = `
changelog:
  categories:
    - title: Features
      commit_patterns:
        - "^feat(\\\\([^)]+\\\\))?:"
    - title: Bug Fixes
      commit_patterns:
        - "^fix(\\\\([^)]+\\\\))?:"
`;

    it('matches PRs based on commit_patterns', async () => {
      setup([
        {
          hash: 'abc123',
          title: 'feat: add new feature',
          body: '',
          pr: { local: '1', remote: { number: '1', author: { login: 'alice' } } },
        },
        {
          hash: 'def456',
          title: 'fix: fix bug',
          body: '',
          pr: { local: '2', remote: { number: '2', author: { login: 'bob' } } },
        },
      ], PATTERN_CONFIG);
      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 3);
      expect(result.changelog).toMatchSnapshot();
    });

    it('labels take precedence over commit_patterns', async () => {
      const mixedConfig = `
changelog:
  categories:
    - title: Labeled Features
      labels:
        - enhancement
    - title: Pattern Features
      commit_patterns:
        - "^feat:"
`;
      setup([
        {
          hash: 'abc123',
          title: 'feat: labeled feature',
          body: '',
          pr: { local: '1', remote: { number: '1', author: { login: 'alice' }, labels: ['enhancement'] } },
        },
        {
          hash: 'def456',
          title: 'feat: pattern-only feature',
          body: '',
          pr: { local: '2', remote: { number: '2', author: { login: 'bob' } } },
        },
      ], mixedConfig);
      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 3);
      expect(result.changelog).toMatchSnapshot();
    });

    it('uses default conventional commits config when no config exists', async () => {
      setup([
        {
          hash: 'abc123',
          title: 'feat: new feature',
          body: '',
          pr: { local: '1', remote: { number: '1', author: { login: 'alice' } } },
        },
        {
          hash: 'def456',
          title: 'fix: bug fix',
          body: '',
          pr: { local: '2', remote: { number: '2', author: { login: 'bob' } } },
        },
        {
          hash: 'ghi789',
          title: 'docs: update readme',
          body: '',
          pr: { local: '3', remote: { number: '3', author: { login: 'charlie' } } },
        },
      ], null);
      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 10);
      expect(result.changelog).toMatchSnapshot();
    });
  });

  // ============================================================================
  // Scope grouping tests
  // ============================================================================

  describe('scope grouping', () => {
    const SCOPE_CONFIG = `
changelog:
  scopeGrouping: true
  categories:
    - title: Features
      commit_patterns:
        - "^feat(\\\\([^)]+\\\\))?:"
`;

    it('groups PRs by scope when multiple entries exist', async () => {
      setup([
        {
          hash: 'abc123',
          title: 'feat(api): add endpoint 1',
          body: '',
          pr: { local: '1', remote: { number: '1', author: { login: 'alice' } } },
        },
        {
          hash: 'def456',
          title: 'feat(api): add endpoint 2',
          body: '',
          pr: { local: '2', remote: { number: '2', author: { login: 'bob' } } },
        },
        {
          hash: 'ghi789',
          title: 'feat(ui): add button',
          body: '',
          pr: { local: '3', remote: { number: '3', author: { login: 'charlie' } } },
        },
      ], SCOPE_CONFIG);
      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 10);
      expect(result.changelog).toMatchSnapshot();
    });

    it('places scopeless entries at bottom', async () => {
      setup([
        {
          hash: 'abc123',
          title: 'feat(api): scoped feature 1',
          body: '',
          pr: { local: '1', remote: { number: '1', author: { login: 'alice' } } },
        },
        {
          hash: 'def456',
          title: 'feat(api): scoped feature 2',
          body: '',
          pr: { local: '2', remote: { number: '2', author: { login: 'bob' } } },
        },
        {
          hash: 'ghi789',
          title: 'feat: scopeless feature',
          body: '',
          pr: { local: '3', remote: { number: '3', author: { login: 'charlie' } } },
        },
      ], SCOPE_CONFIG);
      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 10);
      expect(result.changelog).toMatchSnapshot();
    });
  });

  // ============================================================================
  // Custom changelog entries tests
  // ============================================================================

  describe('custom changelog entries', () => {
    it('uses custom entry from PR body', async () => {
      setup([
        {
          hash: 'abc123',
          title: 'feat: original title',
          body: '',
          pr: {
            local: '1',
            remote: {
              number: '1',
              author: { login: 'alice' },
              body: '## Changelog Entry\n\n- Custom changelog entry',
            },
          },
        },
      ], null);
      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 3);
      expect(result.changelog).toMatchSnapshot();
    });

    it('handles multiple bullets in changelog entry', async () => {
      setup([
        {
          hash: 'abc123',
          title: 'feat: original title',
          body: '',
          pr: {
            local: '1',
            remote: {
              number: '1',
              author: { login: 'alice' },
              body: '## Changelog Entry\n\n- First entry\n- Second entry\n- Third entry',
            },
          },
        },
      ], null);
      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 10);
      expect(result.changelog).toMatchSnapshot();
    });

    it('handles nested bullets in changelog entry', async () => {
      setup([
        {
          hash: 'abc123',
          title: 'feat: original title',
          body: '',
          pr: {
            local: '1',
            remote: {
              number: '1',
              author: { login: 'alice' },
              body: '## Changelog Entry\n\n- Main entry\n  - Nested item 1\n  - Nested item 2',
            },
          },
        },
      ], null);
      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 10);
      expect(result.changelog).toMatchSnapshot();
    });
  });
});

