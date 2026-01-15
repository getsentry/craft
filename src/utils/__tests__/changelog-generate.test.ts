import {
  vi,
  type Mock,
  type MockInstance,
  type Mocked,
  type MockedFunction,
} from 'vitest';
/**
 * Tests for generateChangesetFromGit - the main changelog generation function.
 * Uses snapshot testing for output validation to reduce test file size.
 */

vi.mock('../githubApi.ts');
import { getGitHubClient } from '../githubApi';
vi.mock('../git');
import { getChangesSince } from '../git';
vi.mock('fs', async importOriginal => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    readFileSync: vi.fn(),
  };
});
vi.mock('../../config', async importOriginal => {
  const actual = await importOriginal<typeof import('../../config')>();
  return {
    ...actual,
    getConfigFileDir: vi.fn(),
    getGlobalGitHubConfig: vi.fn(),
  };
});
import * as config from '../../config';
import { readFileSync } from 'fs';
import type { SimpleGit } from 'simple-git';

import {
  generateChangesetFromGit,
  generateChangelogWithHighlight,
  clearChangesetCache,
  clearReleaseConfigCache,
} from '../changelog';
import { type TestCommit } from './fixtures/changelog';

const getConfigFileDirMock = config.getConfigFileDir as MockedFunction<
  typeof config.getConfigFileDir
>;
const getGlobalGitHubConfigMock =
  config.getGlobalGitHubConfig as MockedFunction<
    typeof config.getGlobalGitHubConfig
  >;
const readFileSyncMock = readFileSync as MockedFunction<typeof readFileSync>;

describe('generateChangesetFromGit', () => {
  let mockClient: Mock;
  const mockGetChangesSince = getChangesSince as MockedFunction<
    typeof getChangesSince
  >;
  const dummyGit = {} as SimpleGit;

  beforeEach(() => {
    vi.resetAllMocks();
    clearChangesetCache();
    clearReleaseConfigCache();
    mockClient = vi.fn();
    (getGitHubClient as MockedFunction<typeof getGitHubClient>).mockReturnValue(
      {
        graphql: mockClient,
      } as any,
    );
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
      })),
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
        ]),
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
          if (
            typeof path === 'string' &&
            path.includes('.github/release.yml')
          ) {
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
      setup(
        [{ hash: 'abcdef1234567890', title: 'Upgraded the kernel', body: '' }],
        null,
      );
      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 3);
      expect(result.changelog).toMatchSnapshot();
    });

    it('uses PR number when available locally', async () => {
      setup(
        [
          {
            hash: 'abcdef1234567890',
            title: 'Upgraded the kernel (#123)',
            body: '',
            pr: { local: '123' },
          },
        ],
        null,
      );
      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 3);
      expect(result.changelog).toMatchSnapshot();
    });

    it('uses PR number and author from remote', async () => {
      setup(
        [
          {
            hash: 'abcdef1234567890',
            title: 'Upgraded the kernel',
            body: '',
            pr: { remote: { number: '123', author: { login: 'sentry' } } },
          },
        ],
        null,
      );
      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 3);
      expect(result.changelog).toMatchSnapshot();
    });

    it('handles null PR author gracefully', async () => {
      setup(
        [
          {
            hash: 'abcdef1234567890',
            title: 'Upgraded the kernel',
            body: '',
            pr: { remote: { number: '123' } },
          },
        ],
        null,
      );
      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 3);
      expect(result.changelog).toMatchSnapshot();
    });

    it('uses PR title from GitHub instead of commit message', async () => {
      setup(
        [
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
        ],
        null,
      );
      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 3);
      expect(result.changelog).toMatchSnapshot();
    });

    it('handles multiple commits', async () => {
      setup(
        [
          { hash: 'abcdef1234567890', title: 'Upgraded the kernel', body: '' },
          {
            hash: 'bcdef1234567890a',
            title: 'Upgraded the manifold (#123)',
            body: '',
            pr: {
              local: '123',
              remote: { number: '123', author: { login: 'alice' } },
            },
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
        ],
        null,
      );
      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 3);
      expect(result.changelog).toMatchSnapshot();
    });

    it('escapes underscores in titles', async () => {
      setup(
        [
          {
            hash: 'abcdef1234567890',
            title: 'Serialized _meta',
            body: '',
            pr: { remote: { number: '123' } },
          },
        ],
        null,
      );
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
      setup(
        [
          {
            hash: 'abc123',
            title: 'Feature PR',
            body: '',
            pr: {
              local: '1',
              remote: {
                number: '1',
                author: { login: 'alice' },
                labels: ['enhancement'],
              },
            },
          },
          {
            hash: 'def456',
            title: 'Bug fix PR',
            body: '',
            pr: {
              local: '2',
              remote: {
                number: '2',
                author: { login: 'bob' },
                labels: ['bug'],
              },
            },
          },
        ],
        BASIC_CONFIG,
      );
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
      setup(
        [
          {
            hash: 'abc123',
            title: 'Normal feature',
            body: '',
            pr: {
              local: '1',
              remote: {
                number: '1',
                author: { login: 'alice' },
                labels: ['enhancement'],
              },
            },
          },
          {
            hash: 'def456',
            title: 'Should be excluded by label',
            body: '',
            pr: {
              local: '2',
              remote: {
                number: '2',
                author: { login: 'bob' },
                labels: ['enhancement', 'skip-changelog'],
              },
            },
          },
          {
            hash: 'ghi789',
            title: 'Should be excluded by author',
            body: '',
            pr: {
              local: '3',
              remote: {
                number: '3',
                author: { login: 'dependabot' },
                labels: ['enhancement'],
              },
            },
          },
        ],
        configWithExclusions,
      );
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
      setup(
        [
          {
            hash: 'abc123',
            title: 'Any PR',
            body: '',
            pr: {
              local: '1',
              remote: {
                number: '1',
                author: { login: 'alice' },
                labels: ['random-label'],
              },
            },
          },
        ],
        wildcardConfig,
      );
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
      setup(
        [
          {
            hash: 'abc123',
            title: 'feat: add new feature',
            body: '',
            pr: {
              local: '1',
              remote: { number: '1', author: { login: 'alice' } },
            },
          },
          {
            hash: 'def456',
            title: 'fix: fix bug',
            body: '',
            pr: {
              local: '2',
              remote: { number: '2', author: { login: 'bob' } },
            },
          },
        ],
        PATTERN_CONFIG,
      );
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
      setup(
        [
          {
            hash: 'abc123',
            title: 'feat: labeled feature',
            body: '',
            pr: {
              local: '1',
              remote: {
                number: '1',
                author: { login: 'alice' },
                labels: ['enhancement'],
              },
            },
          },
          {
            hash: 'def456',
            title: 'feat: pattern-only feature',
            body: '',
            pr: {
              local: '2',
              remote: { number: '2', author: { login: 'bob' } },
            },
          },
        ],
        mixedConfig,
      );
      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 3);
      expect(result.changelog).toMatchSnapshot();
    });

    it('uses default conventional commits config when no config exists', async () => {
      setup(
        [
          {
            hash: 'abc123',
            title: 'feat: new feature',
            body: '',
            pr: {
              local: '1',
              remote: { number: '1', author: { login: 'alice' } },
            },
          },
          {
            hash: 'def456',
            title: 'fix: bug fix',
            body: '',
            pr: {
              local: '2',
              remote: { number: '2', author: { login: 'bob' } },
            },
          },
          {
            hash: 'ghi789',
            title: 'docs: update readme',
            body: '',
            pr: {
              local: '3',
              remote: { number: '3', author: { login: 'charlie' } },
            },
          },
        ],
        null,
      );
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
      setup(
        [
          {
            hash: 'abc123',
            title: 'feat(api): add endpoint 1',
            body: '',
            pr: {
              local: '1',
              remote: { number: '1', author: { login: 'alice' } },
            },
          },
          {
            hash: 'def456',
            title: 'feat(api): add endpoint 2',
            body: '',
            pr: {
              local: '2',
              remote: { number: '2', author: { login: 'bob' } },
            },
          },
          {
            hash: 'ghi789',
            title: 'feat(ui): add button',
            body: '',
            pr: {
              local: '3',
              remote: { number: '3', author: { login: 'charlie' } },
            },
          },
        ],
        SCOPE_CONFIG,
      );
      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 10);
      expect(result.changelog).toMatchSnapshot();
    });

    it('places scopeless entries at bottom', async () => {
      setup(
        [
          {
            hash: 'abc123',
            title: 'feat(api): scoped feature 1',
            body: '',
            pr: {
              local: '1',
              remote: { number: '1', author: { login: 'alice' } },
            },
          },
          {
            hash: 'def456',
            title: 'feat(api): scoped feature 2',
            body: '',
            pr: {
              local: '2',
              remote: { number: '2', author: { login: 'bob' } },
            },
          },
          {
            hash: 'ghi789',
            title: 'feat: scopeless feature',
            body: '',
            pr: {
              local: '3',
              remote: { number: '3', author: { login: 'charlie' } },
            },
          },
        ],
        SCOPE_CONFIG,
      );
      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 10);
      expect(result.changelog).toMatchSnapshot();
    });

    it('shows Other header for single-scope entries when scope groups exist', async () => {
      setup(
        [
          {
            hash: 'abc123',
            title: 'feat(api): api feature 1',
            body: '',
            pr: {
              local: '1',
              remote: { number: '1', author: { login: 'alice' } },
            },
          },
          {
            hash: 'def456',
            title: 'feat(api): api feature 2',
            body: '',
            pr: {
              local: '2',
              remote: { number: '2', author: { login: 'bob' } },
            },
          },
          {
            hash: 'ghi789',
            title: 'feat(ui): single ui feature',
            body: '',
            pr: {
              local: '3',
              remote: { number: '3', author: { login: 'charlie' } },
            },
          },
        ],
        SCOPE_CONFIG,
      );
      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 10);
      // Single-scope entry should be under "Other" header
      expect(result.changelog).toContain('#### Api');
      expect(result.changelog).toContain('#### Other');
      expect(result.changelog).toContain('feat(ui): single ui feature');
    });

    it('does not show Other header when only scopeless entries exist', async () => {
      setup(
        [
          {
            hash: 'abc123',
            title: 'feat: feature 1',
            body: '',
            pr: {
              local: '1',
              remote: { number: '1', author: { login: 'alice' } },
            },
          },
          {
            hash: 'def456',
            title: 'feat: feature 2',
            body: '',
            pr: {
              local: '2',
              remote: { number: '2', author: { login: 'bob' } },
            },
          },
        ],
        SCOPE_CONFIG,
      );
      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 10);
      // No scope headers, so no "Other" header needed
      expect(result.changelog).not.toContain('#### Api');
      expect(result.changelog).not.toContain('#### Other');
      expect(result.changelog).toContain('feat: feature 1');
      expect(result.changelog).toContain('feat: feature 2');
    });

    it('does not show Other header when all scopes are single-entry', async () => {
      setup(
        [
          {
            hash: 'abc123',
            title: 'feat(api): single api feature',
            body: '',
            pr: {
              local: '1',
              remote: { number: '1', author: { login: 'alice' } },
            },
          },
          {
            hash: 'def456',
            title: 'feat(ui): single ui feature',
            body: '',
            pr: {
              local: '2',
              remote: { number: '2', author: { login: 'bob' } },
            },
          },
        ],
        SCOPE_CONFIG,
      );
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
      setup(
        [
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
        ],
        null,
      );
      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 3);
      expect(result.changelog).toMatchSnapshot();
    });

    it('handles multiple bullets in changelog entry', async () => {
      setup(
        [
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
        ],
        null,
      );
      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 10);
      expect(result.changelog).toMatchSnapshot();
    });

    it('handles nested bullets in changelog entry', async () => {
      setup(
        [
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
        ],
        null,
      );
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
      // Commits in newest-first order (git log order)
      setup(
        [
          {
            hash: 'def456',
            title: 'Revert "feat: add new feature"',
            body: 'This reverts commit abc123.',
            pr: {
              local: '2',
              remote: { number: '2', author: { login: 'bob' } },
            },
          },
          {
            hash: 'abc123',
            title: 'feat: add new feature',
            body: '',
            pr: {
              local: '1',
              remote: { number: '1', author: { login: 'alice' } },
            },
          },
        ],
        null,
      );
      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 10);
      // Both commits should cancel out, resulting in empty changelog
      expect(result.changelog).toBe('');
      expect(result.bumpType).toBeNull();
    });

    it('cancels out a simple revert via title fallback', async () => {
      // When no SHA in body, fall back to title matching
      // Commits in newest-first order (git log order)
      setup(
        [
          {
            hash: 'def456',
            title: 'Revert "feat: add new feature"',
            body: '', // No SHA in body
            pr: {
              local: '2',
              remote: { number: '2', author: { login: 'bob' } },
            },
          },
          {
            hash: 'abc123',
            title: 'feat: add new feature',
            body: '',
            pr: {
              local: '1',
              remote: { number: '1', author: { login: 'alice' } },
            },
          },
        ],
        null,
      );
      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 10);
      expect(result.changelog).toBe('');
      expect(result.bumpType).toBeNull();
    });

    it('keeps standalone revert when original is not in changelog', async () => {
      // Revert without corresponding original commit stays as bug fix
      setup(
        [
          {
            hash: 'def456',
            title: 'Revert "feat: add feature from previous release"',
            body: 'This reverts commit oldsha123.',
            pr: {
              local: '2',
              remote: { number: '2', author: { login: 'bob' } },
            },
          },
        ],
        null,
      );
      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 10);
      // Revert should appear in Bug Fixes category with full title
      expect(result.changelog).toContain('Bug Fixes');
      expect(result.changelog).toContain(
        'Revert "feat: add feature from previous release"',
      );
      expect(result.bumpType).toBe('patch');
    });

    it('handles double revert correctly (A -> Revert A -> Revert Revert A)', async () => {
      // A -> B (Revert A) -> C (Revert B)
      // Expected: C cancels B, A remains
      // Commits in newest-first order (git log order)
      setup(
        [
          {
            hash: 'ccc333',
            title: 'Revert "Revert "feat: add feature""',
            body: 'This reverts commit bbb222.',
            pr: {
              local: '3',
              remote: { number: '3', author: { login: 'charlie' } },
            },
          },
          {
            hash: 'bbb222',
            title: 'Revert "feat: add feature"',
            body: 'This reverts commit aaa111.',
            pr: {
              local: '2',
              remote: { number: '2', author: { login: 'bob' } },
            },
          },
          {
            hash: 'aaa111',
            title: 'feat: add feature',
            body: '',
            pr: {
              local: '1',
              remote: { number: '1', author: { login: 'alice' } },
            },
          },
        ],
        null,
      );
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
      // Commits in newest-first order (git log order)
      setup(
        [
          {
            hash: 'ddd444',
            title: 'Revert "Revert "Revert "feat: add feature"""',
            body: 'This reverts commit ccc333.',
            pr: {
              local: '4',
              remote: { number: '4', author: { login: 'dave' } },
            },
          },
          {
            hash: 'ccc333',
            title: 'Revert "Revert "feat: add feature""',
            body: 'This reverts commit bbb222.',
            pr: {
              local: '3',
              remote: { number: '3', author: { login: 'charlie' } },
            },
          },
          {
            hash: 'bbb222',
            title: 'Revert "feat: add feature"',
            body: 'This reverts commit aaa111.',
            pr: {
              local: '2',
              remote: { number: '2', author: { login: 'bob' } },
            },
          },
          {
            hash: 'aaa111',
            title: 'feat: add feature',
            body: '',
            pr: {
              local: '1',
              remote: { number: '1', author: { login: 'alice' } },
            },
          },
        ],
        null,
      );
      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 10);
      // D cancels C, B cancels A -> empty
      expect(result.changelog).toBe('');
      expect(result.bumpType).toBeNull();
    });

    it('handles quadruple revert correctly (original remains)', async () => {
      // A -> B -> C -> D -> E (each reverts previous)
      // Processing newest first:
      // E cancels D, C cancels B, A remains
      // Commits in newest-first order (git log order)
      setup(
        [
          {
            hash: 'eee555',
            title: 'Revert "Revert "Revert "Revert "feat: add feature""""',
            body: 'This reverts commit ddd444.',
            pr: {
              local: '5',
              remote: { number: '5', author: { login: 'eve' } },
            },
          },
          {
            hash: 'ddd444',
            title: 'Revert "Revert "Revert "feat: add feature"""',
            body: 'This reverts commit ccc333.',
            pr: {
              local: '4',
              remote: { number: '4', author: { login: 'dave' } },
            },
          },
          {
            hash: 'ccc333',
            title: 'Revert "Revert "feat: add feature""',
            body: 'This reverts commit bbb222.',
            pr: {
              local: '3',
              remote: { number: '3', author: { login: 'charlie' } },
            },
          },
          {
            hash: 'bbb222',
            title: 'Revert "feat: add feature"',
            body: 'This reverts commit aaa111.',
            pr: {
              local: '2',
              remote: { number: '2', author: { login: 'bob' } },
            },
          },
          {
            hash: 'aaa111',
            title: 'feat: add feature',
            body: '',
            pr: {
              local: '1',
              remote: { number: '1', author: { login: 'alice' } },
            },
          },
        ],
        null,
      );
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
      // Commits in newest-first order (git log order)
      setup(
        [
          {
            hash: 'ccc333',
            title: 'Revert "feat: add feature"',
            body: 'This reverts commit aaa111.', // SHA points to first
            pr: {
              local: '3',
              remote: { number: '3', author: { login: 'charlie' } },
            },
          },
          {
            hash: 'bbb222',
            title: 'feat: add feature', // Same title as first
            body: '',
            pr: {
              local: '2',
              remote: { number: '2', author: { login: 'bob' } },
            },
          },
          {
            hash: 'aaa111',
            title: 'feat: add feature',
            body: '',
            pr: {
              local: '1',
              remote: { number: '1', author: { login: 'alice' } },
            },
          },
        ],
        null,
      );
      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 10);
      // First feat and revert cancel, second feat remains
      expect(result.changelog).toContain('Add feature');
      expect(result.changelog).not.toContain('Revert');
      expect(result.bumpType).toBe('minor');
    });

    it('handles revert with PR number suffix in title', async () => {
      // GitHub often includes PR number in title like: Revert "feat: add feature (#1)"
      // Commits in newest-first order (git log order)
      setup(
        [
          {
            hash: 'def456',
            title: 'Revert "feat: add feature (#1)" (#2)',
            body: 'This reverts commit abc123.',
            pr: {
              local: '2',
              remote: { number: '2', author: { login: 'bob' } },
            },
          },
          {
            hash: 'abc123',
            title: 'feat: add feature (#1)',
            body: '',
            pr: {
              local: '1',
              remote: { number: '1', author: { login: 'alice' } },
            },
          },
        ],
        null,
      );
      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 10);
      expect(result.changelog).toBe('');
    });

    it('uses PR title for matching when available', async () => {
      // PR title differs from commit title, should use PR title for matching
      // Commits in newest-first order (git log order)
      setup(
        [
          {
            hash: 'def456',
            title: 'Revert "feat: add feature"', // Matches PR title, not commit title
            body: '',
            pr: {
              local: '2',
              remote: { number: '2', author: { login: 'bob' } },
            },
          },
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
        ],
        null,
      );
      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 10);
      expect(result.changelog).toBe('');
    });

    it('extracts SHA from body with additional explanation text', async () => {
      // Revert body often contains explanation in addition to the "This reverts commit" line
      // Commits in newest-first order (git log order)
      setup(
        [
          {
            hash: 'def456abc123',
            title: 'Revert "feat: add new feature"',
            body: `This reverts commit abc123def456.

The feature caused performance issues in production.
We need to investigate further before re-enabling.

See incident report: https://example.com/incident/123`,
            pr: {
              local: '2',
              remote: { number: '2', author: { login: 'bob' } },
            },
          },
          {
            hash: 'abc123def456',
            title: 'feat: add new feature',
            body: '',
            pr: {
              local: '1',
              remote: { number: '1', author: { login: 'alice' } },
            },
          },
        ],
        null,
      );
      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 10);
      // Both should cancel out despite the additional text in the body
      expect(result.changelog).toBe('');
      expect(result.bumpType).toBeNull();
    });

    it('detects revert from body when title does not follow standard format', async () => {
      // Sometimes the title may not follow the "Revert "..."" format,
      // but the body still contains "This reverts commit <sha>"
      // Commits in newest-first order (git log order)
      setup(
        [
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
          {
            hash: 'abc123def456',
            title: 'feat: add new feature',
            body: '',
            pr: {
              local: '1',
              remote: { number: '1', author: { login: 'alice' } },
            },
          },
        ],
        null,
      );
      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 10);
      // Both should cancel out because body contains the revert magic string with SHA
      expect(result.changelog).toBe('');
      expect(result.bumpType).toBeNull();
    });
  });

  describe('PR deduplication', () => {
    it('deduplicates commits with same PR number from rebase-merge workflows', async () => {
      // When using rebase-merge, all individual commits from a PR are added to
      // the base branch and each gets associated with the same PR number.
      // We should only show the PR once in the changelog.
      setup(
        [
          {
            hash: 'commit1',
            title: 'feat(ui): add button component',
            body: '',
            pr: {
              local: '42',
              remote: {
                number: '42',
                title: 'feat(ui): add button component',
                author: { login: 'alice' },
              },
            },
          },
          {
            hash: 'commit2',
            title: 'feat(ui): add button styles',
            body: '',
            pr: {
              local: '42',
              remote: {
                number: '42',
                title: 'feat(ui): add button component', // Same PR, same title from API
                author: { login: 'alice' },
              },
            },
          },
          {
            hash: 'commit3',
            title: 'feat(ui): add button tests',
            body: '',
            pr: {
              local: '42',
              remote: {
                number: '42',
                title: 'feat(ui): add button component', // Same PR, same title from API
                author: { login: 'alice' },
              },
            },
          },
        ],
        null,
      );

      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 10);

      // PR #42 should appear only once, not three times
      const matches = result.changelog.match(/#42/g);
      expect(matches).toHaveLength(1);
      expect(result.changelog).toContain('Add button component');
    });

    it('keeps commits without PR association even if they share hashes', async () => {
      // Commits without PR association should all be kept
      setup(
        [
          {
            hash: 'commit1',
            title: 'chore: update dependencies',
            body: '',
            // No PR association
          },
          {
            hash: 'commit2',
            title: 'chore: fix typo',
            body: '',
            // No PR association
          },
        ],
        null,
      );

      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 10);

      // Both commits should appear (in leftovers since no PR)
      expect(result.changelog).toContain('update dependencies');
      expect(result.changelog).toContain('fix typo');
    });
  });
});

describe('generateChangelogWithHighlight', () => {
  let mockGraphqlClient: Mock;
  let mockRestClient: {
    pulls: { get: Mock };
    issues: { listLabelsOnIssue: Mock };
  };
  const mockGetChangesSince = getChangesSince as MockedFunction<
    typeof getChangesSince
  >;
  const dummyGit = {
    fetch: vi.fn().mockResolvedValue(undefined),
  } as unknown as SimpleGit;

  beforeEach(() => {
    vi.resetAllMocks();
    clearChangesetCache();
    clearReleaseConfigCache();
    mockGraphqlClient = vi.fn();
    mockRestClient = {
      pulls: { get: vi.fn() },
      issues: { listLabelsOnIssue: vi.fn() },
    };
    (getGitHubClient as MockedFunction<typeof getGitHubClient>).mockReturnValue(
      {
        graphql: mockGraphqlClient,
        ...mockRestClient,
      } as any,
    );
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

  interface HighlightSetupOptions {
    currentPR: {
      number: number;
      title: string;
      body?: string;
      author?: string;
      labels?: string[];
      baseRef?: string;
      headSha?: string;
    };
    existingCommits: TestCommit[];
    releaseConfig?: string | null;
  }

  function setup(options: HighlightSetupOptions): void {
    const { currentPR, existingCommits, releaseConfig } = options;

    // Mock GitHub API for current PR
    mockRestClient.pulls.get.mockResolvedValueOnce({
      data: {
        title: currentPR.title,
        body: currentPR.body ?? '',
        user: { login: currentPR.author ?? 'testuser' },
        base: { ref: currentPR.baseRef ?? 'main' },
        head: { sha: currentPR.headSha ?? 'pr-head-sha' },
      },
    });
    mockRestClient.issues.listLabelsOnIssue.mockResolvedValueOnce({
      data: (currentPR.labels ?? []).map(name => ({ name })),
    });

    // Mock git changes (existing commits in base branch)
    mockGetChangesSince.mockResolvedValueOnce(
      existingCommits.map(commit => ({
        hash: commit.hash,
        title: commit.title,
        body: commit.body,
        pr: commit.pr?.local || null,
      })),
    );

    // Mock GraphQL for commit info
    mockGraphqlClient.mockResolvedValueOnce({
      repository: Object.fromEntries(
        existingCommits.map(({ hash, author, title, pr }: TestCommit) => [
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
        ]),
      ),
    });

    if (releaseConfig !== undefined) {
      if (releaseConfig === null) {
        getConfigFileDirMock.mockReturnValue(undefined);
      } else {
        getConfigFileDirMock.mockReturnValue('/workspace');
        readFileSyncMock.mockImplementation((path: any) => {
          if (
            typeof path === 'string' &&
            path.includes('.github/release.yml')
          ) {
            return releaseConfig;
          }
          const error: any = new Error('ENOENT');
          error.code = 'ENOENT';
          throw error;
        });
      }
    }
  }

  describe('revert handling in PR preview', () => {
    it('cancels out revert PR with its target commit', async () => {
      setup({
        currentPR: {
          number: 2,
          title: 'Revert "feat: add feature"',
          body: 'This reverts commit abc123.\n\nReverting due to issues.',
          author: 'bob',
        },
        existingCommits: [
          {
            hash: 'abc123',
            title: 'feat: add feature',
            body: '',
            pr: {
              local: '1',
              remote: { number: '1', author: { login: 'alice' } },
            },
          },
        ],
      });

      const result = await generateChangelogWithHighlight(dummyGit, '1.0.0', 2);

      // Both should cancel out
      expect(result.changelog).toBe('');
      expect(result.bumpType).toBeNull();
      expect(result.prSkipped).toBe(false);
    });

    it('returns correct bump type when revert cancels and other commits remain', async () => {
      setup({
        currentPR: {
          number: 3,
          title: 'Revert "feat: add feature"',
          body: 'This reverts commit abc123.',
          author: 'charlie',
        },
        existingCommits: [
          {
            hash: 'abc123',
            title: 'feat: add feature',
            body: '',
            pr: {
              local: '1',
              remote: { number: '1', author: { login: 'alice' } },
            },
          },
          {
            hash: 'def456',
            title: 'fix: bug fix',
            body: '',
            pr: {
              local: '2',
              remote: { number: '2', author: { login: 'bob' } },
            },
          },
        ],
      });

      const result = await generateChangelogWithHighlight(dummyGit, '1.0.0', 3);

      // Revert and feat cancel out, only fix remains
      expect(result.changelog).toContain('Bug Fixes');
      expect(result.changelog).toContain('Bug fix');
      expect(result.changelog).not.toContain('Add feature');
      expect(result.changelog).not.toContain('Revert');
      // Bump type should be patch (from fix), not minor (from cancelled feat)
      expect(result.bumpType).toBe('patch');
    });

    it('returns remaining commits bump type when revert PR cancels (PR 676 interaction)', async () => {
      // This test verifies the interaction between PR 676 fix and revert handling:
      // When a revert PR cancels another commit, the bump type should come from
      // the REMAINING commits (not the revert PR's own bump type which would be 'patch').
      setup({
        currentPR: {
          number: 3,
          title: 'Revert "fix: bug fix"', // Revert's own bump type would be 'patch'
          body: 'This reverts commit def456.',
          author: 'charlie',
        },
        existingCommits: [
          {
            hash: 'def456',
            title: 'fix: bug fix', // This gets cancelled
            body: '',
            pr: {
              local: '2',
              remote: { number: '2', author: { login: 'bob' } },
            },
          },
          {
            hash: 'abc123',
            title: 'feat: new feature', // This remains -> minor bump
            body: '',
            pr: {
              local: '1',
              remote: { number: '1', author: { login: 'alice' } },
            },
          },
        ],
      });

      const result = await generateChangelogWithHighlight(dummyGit, '1.0.0', 3);

      // Revert and fix cancel out, feat remains
      expect(result.changelog).toContain('New Features');
      expect(result.changelog).toContain('New feature');
      expect(result.changelog).not.toContain('Bug fix');
      expect(result.changelog).not.toContain('Revert');
      // Bump type should be 'minor' (from remaining feat), NOT 'patch' (revert's own bump type)
      expect(result.bumpType).toBe('minor');
    });

    it('handles double revert PR correctly', async () => {
      // existingCommits are in git log order (newest first)
      // Current PR is prepended, so final order is: [currentPR, def456, abc123]
      // Processing newest first: currentPR reverts def456 -> remove both -> abc123 remains
      setup({
        currentPR: {
          number: 3,
          title: 'Revert "Revert "feat: add feature""',
          body: 'This reverts commit def456.',
          author: 'charlie',
        },
        existingCommits: [
          // Newest first (git log order)
          {
            hash: 'def456',
            title: 'Revert "feat: add feature"',
            body: 'This reverts commit abc123.',
            pr: {
              local: '2',
              remote: { number: '2', author: { login: 'bob' } },
            },
          },
          {
            hash: 'abc123',
            title: 'feat: add feature',
            body: '',
            pr: {
              local: '1',
              remote: { number: '1', author: { login: 'alice' } },
            },
          },
        ],
      });

      const result = await generateChangelogWithHighlight(dummyGit, '1.0.0', 3);

      // Current PR cancels def456, abc123 remains
      expect(result.changelog).toContain('New Features');
      expect(result.changelog).toContain('Add feature');
      expect(result.changelog).not.toContain('Revert');
      expect(result.bumpType).toBe('minor');
    });

    it('keeps standalone revert PR when target not in commits', async () => {
      setup({
        currentPR: {
          number: 2,
          title: 'Revert "feat: old feature"',
          body: 'This reverts commit oldsha123.',
          author: 'bob',
        },
        existingCommits: [
          {
            hash: 'abc123',
            title: 'fix: unrelated fix',
            body: '',
            pr: {
              local: '1',
              remote: { number: '1', author: { login: 'alice' } },
            },
          },
        ],
      });

      const result = await generateChangelogWithHighlight(dummyGit, '1.0.0', 2);

      // Revert stays (target not in list), fix also stays
      expect(result.changelog).toContain('Bug Fixes');
      expect(result.changelog).toContain('Revert "feat: old feature"');
      expect(result.changelog).toContain('Unrelated fix');
      expect(result.bumpType).toBe('patch');
    });

    it('highlights current PR entry in changelog', async () => {
      setup({
        currentPR: {
          number: 2,
          title: 'feat: new feature',
          body: 'Adding a great new feature.',
          author: 'bob',
        },
        existingCommits: [
          {
            hash: 'abc123',
            title: 'fix: bug fix',
            body: '',
            pr: {
              local: '1',
              remote: { number: '1', author: { login: 'alice' } },
            },
          },
        ],
      });

      const result = await generateChangelogWithHighlight(dummyGit, '1.0.0', 2);

      // Current PR should be highlighted with blockquote
      expect(result.changelog).toContain('> - New feature');
      expect(result.changelog).toContain('Bug fix');
      expect(result.bumpType).toBe('minor');
    });

    it('returns PR-specific bump type, not aggregated bump from all commits (PR 676 fix)', async () => {
      // This test verifies the fix from PR 676: the bump type should reflect
      // THIS PR's contribution, not the aggregated bump from all commits.
      setup({
        currentPR: {
          number: 2,
          title: 'fix: small bug fix', // patch-level change
          body: 'Fixing a minor bug.',
          author: 'bob',
        },
        existingCommits: [
          {
            hash: 'abc123',
            title: 'feat: major new feature', // minor-level change in history
            body: '',
            pr: {
              local: '1',
              remote: { number: '1', author: { login: 'alice' } },
            },
          },
        ],
      });

      const result = await generateChangelogWithHighlight(dummyGit, '1.0.0', 2);

      // Both entries should appear in changelog
      expect(result.changelog).toContain('Small bug fix');
      expect(result.changelog).toContain('Major new feature');
      // Bump type should be 'patch' (this PR's contribution), NOT 'minor' (from aggregated)
      expect(result.bumpType).toBe('patch');
    });

    it('uses bold formatting instead of @ mentions to avoid pinging', async () => {
      setup({
        currentPR: {
          number: 2,
          title: 'feat: new feature',
          body: '',
          author: 'bob',
        },
        existingCommits: [
          {
            hash: 'abc123',
            title: 'fix: bug fix',
            body: '',
            pr: {
              local: '1',
              remote: { number: '1', author: { login: 'alice' } },
            },
          },
        ],
      });

      const result = await generateChangelogWithHighlight(dummyGit, '1.0.0', 2);

      // Authors should use bold formatting, NOT @ mentions
      expect(result.changelog).toContain('by **bob**');
      expect(result.changelog).toContain('by **alice**');
      expect(result.changelog).not.toContain('@bob');
      expect(result.changelog).not.toContain('@alice');
    });

    it('deduplicates already-merged PRs to avoid duplicate entries (PR 648 fix)', async () => {
      // When a PR is already merged but its title/description is updated,
      // the changelog preview would show the PR twice:
      // 1. From git history (via fetchRawCommitInfo)
      // 2. From the current PR fetch (with highlight: true)
      // This test verifies the deduplication fix.
      setup({
        currentPR: {
          number: 2,
          title: 'feat: updated title after merge', // Title updated after merge
          body: 'Updated description.',
          author: 'bob',
          headSha: 'def456', // Same SHA as in existingCommits
        },
        existingCommits: [
          {
            hash: 'abc123',
            title: 'fix: other bug fix',
            body: '',
            pr: {
              local: '1',
              remote: { number: '1', author: { login: 'alice' } },
            },
          },
          {
            hash: 'def456', // Same PR, appears in git history
            title: 'feat: original title before merge',
            body: '',
            pr: {
              local: '2',
              remote: {
                number: '2',
                title: 'feat: original title before merge',
                author: { login: 'bob' },
              },
            },
          },
        ],
      });

      const result = await generateChangelogWithHighlight(dummyGit, '1.0.0', 2);

      // PR #2 should appear only once (with the updated title from current PR fetch)
      expect(result.changelog).toContain('Updated title after merge');
      expect(result.changelog).not.toContain('Original title before merge');
      // The highlighted entry should use the fresh PR data
      expect(result.changelog).toContain('> - Updated title after merge');
      // Other PRs should still appear normally
      expect(result.changelog).toContain('Other bug fix');
    });
  });

  describe('skip-changelog handling', () => {
    it('returns empty changelog when PR has skip label', async () => {
      setup({
        currentPR: {
          number: 2,
          title: 'feat: skip this',
          body: '',
          author: 'bob',
          labels: ['skip-changelog'],
        },
        existingCommits: [],
      });

      const result = await generateChangelogWithHighlight(dummyGit, '1.0.0', 2);

      expect(result.changelog).toBe('');
      expect(result.prSkipped).toBe(true);
      // Even skipped PRs contribute to version bump based on title
      expect(result.bumpType).toBe('minor');
    });

    it('returns empty changelog when PR body has skip magic word', async () => {
      setup({
        currentPR: {
          number: 2,
          title: 'fix: internal change',
          body: 'This is internal.\n\n#skip-changelog',
          author: 'bob',
        },
        existingCommits: [],
      });

      const result = await generateChangelogWithHighlight(dummyGit, '1.0.0', 2);

      expect(result.changelog).toBe('');
      expect(result.prSkipped).toBe(true);
      expect(result.bumpType).toBe('patch');
    });
  });
});
