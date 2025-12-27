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

    it('shows Other header for single-scope entries when scope groups exist', async () => {
      setup([
        {
          hash: 'abc123',
          title: 'feat(api): api feature 1',
          body: '',
          pr: { local: '1', remote: { number: '1', author: { login: 'alice' } } },
        },
        {
          hash: 'def456',
          title: 'feat(api): api feature 2',
          body: '',
          pr: { local: '2', remote: { number: '2', author: { login: 'bob' } } },
        },
        {
          hash: 'ghi789',
          title: 'feat(ui): single ui feature',
          body: '',
          pr: { local: '3', remote: { number: '3', author: { login: 'charlie' } } },
        },
      ], SCOPE_CONFIG);
      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 10);
      // Single-scope entry should be under "Other" header
      expect(result.changelog).toContain('#### Api');
      expect(result.changelog).toContain('#### Other');
      expect(result.changelog).toContain('feat(ui): single ui feature');
    });

    it('does not show Other header when only scopeless entries exist', async () => {
      setup([
        {
          hash: 'abc123',
          title: 'feat: feature 1',
          body: '',
          pr: { local: '1', remote: { number: '1', author: { login: 'alice' } } },
        },
        {
          hash: 'def456',
          title: 'feat: feature 2',
          body: '',
          pr: { local: '2', remote: { number: '2', author: { login: 'bob' } } },
        },
      ], SCOPE_CONFIG);
      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 10);
      // No scope headers, so no "Other" header needed
      expect(result.changelog).not.toContain('#### Api');
      expect(result.changelog).not.toContain('#### Other');
      expect(result.changelog).toContain('feat: feature 1');
      expect(result.changelog).toContain('feat: feature 2');
    });

    it('does not show Other header when all scopes are single-entry', async () => {
      setup([
        {
          hash: 'abc123',
          title: 'feat(api): single api feature',
          body: '',
          pr: { local: '1', remote: { number: '1', author: { login: 'alice' } } },
        },
        {
          hash: 'def456',
          title: 'feat(ui): single ui feature',
          body: '',
          pr: { local: '2', remote: { number: '2', author: { login: 'bob' } } },
        },
      ], SCOPE_CONFIG);
      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 10);
      // No scope gets 2+ entries, so no headers at all
      expect(result.changelog).not.toContain('#### Api');
      expect(result.changelog).not.toContain('#### Ui');
      expect(result.changelog).not.toContain('#### Other');
      expect(result.changelog).toContain('feat(api): single api feature');
      expect(result.changelog).toContain('feat(ui): single ui feature');
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

  // ============================================================================
  // Revert commit handling tests
  // ============================================================================

  describe('revert handling', () => {
    it('cancels out a simple revert via SHA match', async () => {
      // Commit A and Revert A should cancel each other out
      setup([
        {
          hash: 'abc123',
          title: 'feat: add new feature',
          body: '',
          pr: { local: '1', remote: { number: '1', author: { login: 'alice' } } },
        },
        {
          hash: 'def456',
          title: 'Revert "feat: add new feature"',
          body: 'This reverts commit abc123.',
          pr: { local: '2', remote: { number: '2', author: { login: 'bob' } } },
        },
      ], null);
      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 10);
      // Both commits should cancel out, resulting in empty changelog
      expect(result.changelog).toBe('');
      expect(result.bumpType).toBeNull();
    });

    it('cancels out a simple revert via title fallback', async () => {
      // When no SHA in body, fall back to title matching
      setup([
        {
          hash: 'abc123',
          title: 'feat: add new feature',
          body: '',
          pr: { local: '1', remote: { number: '1', author: { login: 'alice' } } },
        },
        {
          hash: 'def456',
          title: 'Revert "feat: add new feature"',
          body: '', // No SHA in body
          pr: { local: '2', remote: { number: '2', author: { login: 'bob' } } },
        },
      ], null);
      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 10);
      expect(result.changelog).toBe('');
      expect(result.bumpType).toBeNull();
    });

    it('keeps standalone revert when original is not in changelog', async () => {
      // Revert without corresponding original commit stays as bug fix
      setup([
        {
          hash: 'def456',
          title: 'Revert "feat: add feature from previous release"',
          body: 'This reverts commit oldsha123.',
          pr: { local: '2', remote: { number: '2', author: { login: 'bob' } } },
        },
      ], null);
      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 10);
      // Revert should appear in Bug Fixes category with full title
      expect(result.changelog).toContain('Bug Fixes');
      expect(result.changelog).toContain('Revert "feat: add feature from previous release"');
      expect(result.bumpType).toBe('patch');
    });

    it('handles double revert correctly (A -> Revert A -> Revert Revert A)', async () => {
      // A -> B (Revert A) -> C (Revert B)
      // Expected: C cancels B, A remains
      setup([
        {
          hash: 'aaa111',
          title: 'feat: add feature',
          body: '',
          pr: { local: '1', remote: { number: '1', author: { login: 'alice' } } },
        },
        {
          hash: 'bbb222',
          title: 'Revert "feat: add feature"',
          body: 'This reverts commit aaa111.',
          pr: { local: '2', remote: { number: '2', author: { login: 'bob' } } },
        },
        {
          hash: 'ccc333',
          title: 'Revert "Revert "feat: add feature""',
          body: 'This reverts commit bbb222.',
          pr: { local: '3', remote: { number: '3', author: { login: 'charlie' } } },
        },
      ], null);
      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 10);
      // B and C cancel out, A remains
      expect(result.changelog).toContain('New Features');
      expect(result.changelog).toContain('Add feature');
      expect(result.changelog).not.toContain('Revert');
      expect(result.bumpType).toBe('minor');
    });

    it('handles triple revert correctly (all cancel out)', async () => {
      // A -> B (Revert A) -> C (Revert B) -> D (Revert C)
      // Processing newest first:
      // D cancels C, B cancels A -> nothing remains
      setup([
        {
          hash: 'aaa111',
          title: 'feat: add feature',
          body: '',
          pr: { local: '1', remote: { number: '1', author: { login: 'alice' } } },
        },
        {
          hash: 'bbb222',
          title: 'Revert "feat: add feature"',
          body: 'This reverts commit aaa111.',
          pr: { local: '2', remote: { number: '2', author: { login: 'bob' } } },
        },
        {
          hash: 'ccc333',
          title: 'Revert "Revert "feat: add feature""',
          body: 'This reverts commit bbb222.',
          pr: { local: '3', remote: { number: '3', author: { login: 'charlie' } } },
        },
        {
          hash: 'ddd444',
          title: 'Revert "Revert "Revert "feat: add feature"""',
          body: 'This reverts commit ccc333.',
          pr: { local: '4', remote: { number: '4', author: { login: 'dave' } } },
        },
      ], null);
      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 10);
      // D cancels C, B cancels A -> empty
      expect(result.changelog).toBe('');
      expect(result.bumpType).toBeNull();
    });

    it('handles quadruple revert correctly (original remains)', async () => {
      // A -> B -> C -> D -> E (each reverts previous)
      // Processing newest first:
      // E cancels D, C cancels B, A remains
      setup([
        {
          hash: 'aaa111',
          title: 'feat: add feature',
          body: '',
          pr: { local: '1', remote: { number: '1', author: { login: 'alice' } } },
        },
        {
          hash: 'bbb222',
          title: 'Revert "feat: add feature"',
          body: 'This reverts commit aaa111.',
          pr: { local: '2', remote: { number: '2', author: { login: 'bob' } } },
        },
        {
          hash: 'ccc333',
          title: 'Revert "Revert "feat: add feature""',
          body: 'This reverts commit bbb222.',
          pr: { local: '3', remote: { number: '3', author: { login: 'charlie' } } },
        },
        {
          hash: 'ddd444',
          title: 'Revert "Revert "Revert "feat: add feature"""',
          body: 'This reverts commit ccc333.',
          pr: { local: '4', remote: { number: '4', author: { login: 'dave' } } },
        },
        {
          hash: 'eee555',
          title: 'Revert "Revert "Revert "Revert "feat: add feature""""',
          body: 'This reverts commit ddd444.',
          pr: { local: '5', remote: { number: '5', author: { login: 'eve' } } },
        },
      ], null);
      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 10);
      // E cancels D, C cancels B, A remains
      expect(result.changelog).toContain('New Features');
      expect(result.changelog).toContain('Add feature');
      expect(result.changelog).not.toContain('Revert');
      expect(result.bumpType).toBe('minor');
    });

    it('SHA matching takes precedence over title matching', async () => {
      // Two commits with same title, revert SHA points to first one
      // Only first one should be canceled, second remains
      setup([
        {
          hash: 'aaa111',
          title: 'feat: add feature',
          body: '',
          pr: { local: '1', remote: { number: '1', author: { login: 'alice' } } },
        },
        {
          hash: 'bbb222',
          title: 'feat: add feature', // Same title as first
          body: '',
          pr: { local: '2', remote: { number: '2', author: { login: 'bob' } } },
        },
        {
          hash: 'ccc333',
          title: 'Revert "feat: add feature"',
          body: 'This reverts commit aaa111.', // SHA points to first
          pr: { local: '3', remote: { number: '3', author: { login: 'charlie' } } },
        },
      ], null);
      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 10);
      // First feat and revert cancel, second feat remains
      expect(result.changelog).toContain('Add feature');
      expect(result.changelog).not.toContain('Revert');
      expect(result.bumpType).toBe('minor');
    });

    it('handles revert with PR number suffix in title', async () => {
      // GitHub often includes PR number in title like: Revert "feat: add feature (#1)"
      setup([
        {
          hash: 'abc123',
          title: 'feat: add feature (#1)',
          body: '',
          pr: { local: '1', remote: { number: '1', author: { login: 'alice' } } },
        },
        {
          hash: 'def456',
          title: 'Revert "feat: add feature (#1)" (#2)',
          body: 'This reverts commit abc123.',
          pr: { local: '2', remote: { number: '2', author: { login: 'bob' } } },
        },
      ], null);
      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 10);
      expect(result.changelog).toBe('');
    });

    it('uses PR title for matching when available', async () => {
      // PR title differs from commit title, should use PR title for matching
      setup([
        {
          hash: 'abc123',
          title: 'wip commit message',
          body: '',
          pr: {
            local: '1',
            remote: {
              number: '1',
              author: { login: 'alice' },
              title: 'feat: add feature', // PR title is different
            },
          },
        },
        {
          hash: 'def456',
          title: 'Revert "feat: add feature"', // Matches PR title, not commit title
          body: '',
          pr: { local: '2', remote: { number: '2', author: { login: 'bob' } } },
        },
      ], null);
      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 10);
      expect(result.changelog).toBe('');
    });

    it('extracts SHA from body with additional explanation text', async () => {
      // Revert body often contains explanation in addition to the "This reverts commit" line
      setup([
        {
          hash: 'abc123def456',
          title: 'feat: add new feature',
          body: '',
          pr: { local: '1', remote: { number: '1', author: { login: 'alice' } } },
        },
        {
          hash: 'def456abc123',
          title: 'Revert "feat: add new feature"',
          body: `This reverts commit abc123def456.

The feature caused performance issues in production.
We need to investigate further before re-enabling.

See incident report: https://example.com/incident/123`,
          pr: { local: '2', remote: { number: '2', author: { login: 'bob' } } },
        },
      ], null);
      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 10);
      // Both should cancel out despite the additional text in the body
      expect(result.changelog).toBe('');
      expect(result.bumpType).toBeNull();
    });

    it('detects revert from body when title does not follow standard format', async () => {
      // Sometimes the title may not follow the "Revert "..."" format,
      // but the body still contains "This reverts commit <sha>"
      setup([
        {
          hash: 'abc123def456',
          title: 'feat: add new feature',
          body: '',
          pr: { local: '1', remote: { number: '1', author: { login: 'alice' } } },
        },
        {
          hash: 'def456abc123',
          title: 'fix: undo the new feature due to issues', // Non-standard revert title
          body: '',
          pr: {
            local: '2',
            remote: {
              number: '2',
              author: { login: 'bob' },
              body: 'This reverts commit abc123def456.\n\nThe feature caused problems.',
            },
          },
        },
      ], null);
      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 10);
      // Both should cancel out because body contains the revert magic string with SHA
      expect(result.changelog).toBe('');
      expect(result.bumpType).toBeNull();
    });
  });
});
