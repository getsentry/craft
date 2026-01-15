import {
  vi,
  type Mock,
  type MockInstance,
  type Mocked,
  type MockedFunction,
} from 'vitest';
/**
 * Tests for changelog utility functions.
 * - shouldExcludePR: Checks if a PR should be excluded from changelog
 * - shouldSkipCurrentPR: Checks if current PR should skip changelog generation
 * - getBumpTypeForPR: Determines the version bump type for a PR
 * - normalizeReleaseConfig: Normalizes release config and warns about missing semver fields
 *
 * Note: shouldSkipCurrentPR and getBumpTypeForPR read config internally,
 * so they only take the PRInfo argument. More comprehensive tests are
 * in the main changelog.test.ts file with proper config mocking.
 */

import {
  shouldExcludePR,
  shouldSkipCurrentPR,
  getBumpTypeForPR,
  stripTitle,
  isRevertCommit,
  extractRevertedTitle,
  extractRevertedSha,
  processReverts,
  getNormalizedReleaseConfig,
  clearReleaseConfigCache,
  SKIP_CHANGELOG_MAGIC_WORD,
  BODY_IN_CHANGELOG_MAGIC_WORD,
  type CurrentPRInfo,
} from '../changelog';

// Mock the logger to capture warnings
vi.mock('../../logger');

describe('shouldExcludePR', () => {
  // Config must match NormalizedReleaseConfig structure
  const baseConfig = {
    changelog: {
      exclude: {
        labels: ['skip-changelog', 'no-changelog'],
        authors: new Set(['dependabot', 'renovate']),
      },
    },
  };

  it('returns true when PR has excluded label', () => {
    expect(
      shouldExcludePR(
        new Set(['bug', 'skip-changelog']),
        'alice',
        baseConfig as any,
        '',
      ),
    ).toBe(true);
  });

  it('returns true when PR has excluded author', () => {
    expect(
      shouldExcludePR(new Set(['bug']), 'dependabot', baseConfig as any, ''),
    ).toBe(true);
  });

  it('returns false when PR has no exclusion criteria', () => {
    expect(
      shouldExcludePR(new Set(['bug']), 'alice', baseConfig as any, ''),
    ).toBe(false);
  });

  it('returns true when body contains skip magic word', () => {
    expect(
      shouldExcludePR(
        new Set(['bug']),
        'alice',
        baseConfig as any,
        `Some text\n${SKIP_CHANGELOG_MAGIC_WORD}\nMore text`,
      ),
    ).toBe(true);
  });

  it('returns false when config is null', () => {
    expect(shouldExcludePR(new Set(['bug']), 'alice', null, '')).toBe(false);
  });
});

describe('shouldSkipCurrentPR', () => {
  // Note: This function reads config internally, so we can only test
  // the skip magic word behavior without mocking
  const basePRInfo: CurrentPRInfo = {
    number: 123,
    title: 'Test PR',
    body: '',
    author: 'alice',
    labels: [],
    baseRef: 'main',
    headSha: 'abc123',
  };

  it('returns false when PR has no skip magic word', () => {
    expect(shouldSkipCurrentPR(basePRInfo)).toBe(false);
  });

  it('returns true when PR body contains skip magic word', () => {
    const prInfo = {
      ...basePRInfo,
      body: `Some text\n${SKIP_CHANGELOG_MAGIC_WORD}`,
    };
    expect(shouldSkipCurrentPR(prInfo)).toBe(true);
  });
});

describe('getBumpTypeForPR', () => {
  // Note: This function reads config internally and uses default
  // conventional commits patterns
  const basePRInfo: CurrentPRInfo = {
    number: 123,
    title: 'feat: new feature',
    body: '',
    author: 'alice',
    labels: [],
    baseRef: 'main',
    headSha: 'abc123',
  };

  it('returns major for breaking changes', () => {
    const prInfo = { ...basePRInfo, title: 'feat!: breaking change' };
    expect(getBumpTypeForPR(prInfo)).toBe('major');
  });

  it('returns minor for feat commits', () => {
    const prInfo = { ...basePRInfo, title: 'feat: new feature' };
    expect(getBumpTypeForPR(prInfo)).toBe('minor');
  });

  it('returns patch for fix commits', () => {
    const prInfo = { ...basePRInfo, title: 'fix: bug fix' };
    expect(getBumpTypeForPR(prInfo)).toBe('patch');
  });

  it('returns null for unrecognized commit types', () => {
    const prInfo = { ...basePRInfo, title: 'random commit' };
    expect(getBumpTypeForPR(prInfo)).toBeNull();
  });
});

describe('magic word constants', () => {
  it('SKIP_CHANGELOG_MAGIC_WORD is defined', () => {
    expect(SKIP_CHANGELOG_MAGIC_WORD).toBeDefined();
    expect(typeof SKIP_CHANGELOG_MAGIC_WORD).toBe('string');
  });

  it('BODY_IN_CHANGELOG_MAGIC_WORD is defined', () => {
    expect(BODY_IN_CHANGELOG_MAGIC_WORD).toBeDefined();
    expect(typeof BODY_IN_CHANGELOG_MAGIC_WORD).toBe('string');
  });
});

describe('stripTitle', () => {
  describe('with type named group', () => {
    const pattern = /^(?<type>feat(?:\((?<scope>[^)]+)\))?!?:\s*)/;

    it('strips the type prefix', () => {
      expect(stripTitle('feat: add endpoint', pattern, false)).toBe(
        'Add endpoint',
      );
    });

    it('strips type and scope when preserveScope is false', () => {
      expect(stripTitle('feat(api): add endpoint', pattern, false)).toBe(
        'Add endpoint',
      );
    });

    it('preserves scope when preserveScope is true', () => {
      expect(stripTitle('feat(api): add endpoint', pattern, true)).toBe(
        '(api) Add endpoint',
      );
    });

    it('capitalizes first letter after stripping', () => {
      expect(stripTitle('feat: lowercase start', pattern, false)).toBe(
        'Lowercase start',
      );
    });

    it('handles already capitalized content', () => {
      expect(stripTitle('feat: Already Capitalized', pattern, false)).toBe(
        'Already Capitalized',
      );
    });

    it('does not strip if no type match', () => {
      expect(stripTitle('random title', pattern, false)).toBe('random title');
    });

    it('handles breaking change indicator', () => {
      const breakingPattern = /^(?<type>feat(?:\((?<scope>[^)]+)\))?!:\s*)/;
      expect(stripTitle('feat!: breaking change', breakingPattern, false)).toBe(
        'Breaking change',
      );
      expect(
        stripTitle('feat(api)!: breaking api change', breakingPattern, false),
      ).toBe('Breaking api change');
    });

    it('does not strip when pattern has no type group', () => {
      const noGroupPattern = /^feat(?:\([^)]+\))?!?:\s*/;
      expect(stripTitle('feat: add endpoint', noGroupPattern, false)).toBe(
        'feat: add endpoint',
      );
    });
  });

  describe('edge cases', () => {
    const pattern = /^(?<type>feat(?:\((?<scope>[^)]+)\))?!?:\s*)/;

    it('returns original if pattern is undefined', () => {
      expect(stripTitle('feat: add endpoint', undefined, false)).toBe(
        'feat: add endpoint',
      );
    });

    it('does not strip if nothing remains after stripping', () => {
      const exactPattern = /^(?<type>feat:\s*)$/;
      expect(stripTitle('feat: ', exactPattern, false)).toBe('feat: ');
    });

    it('handles scope with special characters', () => {
      expect(stripTitle('feat(my-api): add endpoint', pattern, true)).toBe(
        '(my-api) Add endpoint',
      );
      expect(stripTitle('feat(my_api): add endpoint', pattern, true)).toBe(
        '(my_api) Add endpoint',
      );
    });

    it('does not preserve scope when scope is not captured', () => {
      const noScopePattern = /^(?<type>feat(?:\([^)]+\))?!?:\s*)/;
      expect(stripTitle('feat(api): add endpoint', noScopePattern, true)).toBe(
        'Add endpoint',
      );
    });
  });

  describe('with different commit types', () => {
    it('works with fix type', () => {
      const pattern = /^(?<type>fix(?:\((?<scope>[^)]+)\))?!?:\s*)/;
      expect(stripTitle('fix(core): resolve bug', pattern, false)).toBe(
        'Resolve bug',
      );
      expect(stripTitle('fix(core): resolve bug', pattern, true)).toBe(
        '(core) Resolve bug',
      );
    });

    it('works with docs type', () => {
      const pattern = /^(?<type>docs?(?:\((?<scope>[^)]+)\))?!?:\s*)/;
      expect(stripTitle('docs(readme): update docs', pattern, false)).toBe(
        'Update docs',
      );
      expect(stripTitle('doc(readme): update docs', pattern, false)).toBe(
        'Update docs',
      );
    });

    it('works with build/chore types', () => {
      const pattern =
        /^(?<type>(?:build|refactor|meta|chore|ci|ref|perf)(?:\((?<scope>[^)]+)\))?!?:\s*)/;
      expect(stripTitle('chore(deps): update deps', pattern, false)).toBe(
        'Update deps',
      );
      expect(stripTitle('build(ci): fix pipeline', pattern, false)).toBe(
        'Fix pipeline',
      );
      expect(stripTitle('refactor(api): simplify logic', pattern, true)).toBe(
        '(api) Simplify logic',
      );
    });
  });
});

describe('isRevertCommit', () => {
  it('returns true for standard revert title format', () => {
    expect(isRevertCommit('Revert "feat: add feature"')).toBe(true);
  });

  it('returns false for non-revert title', () => {
    expect(isRevertCommit('feat: add feature')).toBe(false);
    expect(isRevertCommit('fix: something')).toBe(false);
  });

  it('returns true when body contains revert magic string', () => {
    expect(
      isRevertCommit('fix: undo feature', 'This reverts commit abc123def.'),
    ).toBe(true);
  });

  it('returns false when neither title nor body indicates revert', () => {
    expect(isRevertCommit('fix: something', 'Just a regular fix')).toBe(false);
  });

  it('handles case-insensitive text matching in body', () => {
    // The "This reverts commit" text is matched case-insensitively
    // (SHAs in git are always lowercase, so we only test the text part)
    expect(isRevertCommit('fix: undo', 'THIS REVERTS COMMIT abc123def.')).toBe(
      true,
    );
    expect(isRevertCommit('fix: undo', 'this Reverts Commit abc123def.')).toBe(
      true,
    );
  });
});

describe('extractRevertedSha', () => {
  it('extracts SHA from standard git revert message', () => {
    expect(extractRevertedSha('This reverts commit abc123def456.')).toBe(
      'abc123def456',
    );
  });

  it('extracts SHA without trailing period', () => {
    expect(extractRevertedSha('This reverts commit abc123def456')).toBe(
      'abc123def456',
    );
  });

  it('extracts SHA from body with additional text', () => {
    const body = `This reverts commit abc123def456.

The feature caused issues in production.`;
    expect(extractRevertedSha(body)).toBe('abc123def456');
  });

  it('returns null when no SHA found', () => {
    expect(extractRevertedSha('Just a regular commit body')).toBeNull();
  });

  it('handles abbreviated SHA (7 chars)', () => {
    expect(extractRevertedSha('This reverts commit abc1234.')).toBe('abc1234');
  });

  it('handles full SHA (40 chars)', () => {
    const fullSha = 'abc123def456789012345678901234567890abcd';
    expect(extractRevertedSha(`This reverts commit ${fullSha}.`)).toBe(fullSha);
  });
});

describe('extractRevertedTitle', () => {
  // The regex uses greedy matching (.+) which correctly handles nested quotes
  // because the final " is anchored to the end of the string (before optional PR suffix).
  // This means .+ will consume as much as possible while still allowing
  // the pattern to match, effectively capturing everything between the first "
  // after 'Revert ' and the last " before the end/PR suffix.

  it('extracts title from simple revert', () => {
    expect(extractRevertedTitle('Revert "feat: add feature"')).toBe(
      'feat: add feature',
    );
  });

  it('extracts title from revert with PR suffix', () => {
    expect(extractRevertedTitle('Revert "feat: add feature" (#123)')).toBe(
      'feat: add feature',
    );
  });

  it('extracts title from double revert (nested quotes)', () => {
    // Revert "Revert "feat: add feature""
    // The greedy .+ matches: Revert "feat: add feature"
    expect(extractRevertedTitle('Revert "Revert "feat: add feature""')).toBe(
      'Revert "feat: add feature"',
    );
  });

  it('extracts title from triple revert (deeply nested quotes)', () => {
    // Revert "Revert "Revert "feat: add feature"""
    expect(
      extractRevertedTitle('Revert "Revert "Revert "feat: add feature"""'),
    ).toBe('Revert "Revert "feat: add feature""');
  });

  it('extracts title from quadruple revert', () => {
    // Revert "Revert "Revert "Revert "feat: add feature""""
    expect(
      extractRevertedTitle(
        'Revert "Revert "Revert "Revert "feat: add feature""""',
      ),
    ).toBe('Revert "Revert "Revert "feat: add feature"""');
  });

  it('extracts title with quotes in the message', () => {
    // Revert "fix: handle "special" case"
    expect(extractRevertedTitle('Revert "fix: handle "special" case"')).toBe(
      'fix: handle "special" case',
    );
  });

  it('extracts title from double revert with PR suffix', () => {
    expect(
      extractRevertedTitle('Revert "Revert "feat: add feature"" (#456)'),
    ).toBe('Revert "feat: add feature"');
  });

  it('returns null for non-revert titles', () => {
    expect(extractRevertedTitle('feat: add feature')).toBeNull();
    expect(extractRevertedTitle('Revert without quotes')).toBeNull();
  });

  it('returns null for malformed revert titles', () => {
    // Missing closing quote
    expect(extractRevertedTitle('Revert "feat: add feature')).toBeNull();
    // Extra text after closing quote (without PR format)
    expect(extractRevertedTitle('Revert "feat: add feature" extra')).toBeNull();
  });
});

describe('processReverts', () => {
  // Helper to create a minimal RawCommitInfo-like object
  const commit = (
    hash: string,
    title: string,
    body = '',
    prTitle?: string,
    prBody?: string,
  ) => ({
    hash,
    title,
    body,
    prTitle,
    prBody,
    labels: [] as string[],
  });

  it('returns empty array for empty input', () => {
    expect(processReverts([])).toEqual([]);
  });

  it('cancels out revert and original via SHA', () => {
    // Commits in newest-first order (git log order)
    const commits = [
      commit(
        'def456',
        'Revert "feat: add feature"',
        'This reverts commit abc123.',
      ),
      commit('abc123', 'feat: add feature'),
    ];
    const result = processReverts(commits);
    expect(result).toEqual([]);
  });

  it('cancels out revert and original via title fallback', () => {
    // Commits in newest-first order (git log order)
    const commits = [
      commit('def456', 'Revert "feat: add feature"'),
      commit('abc123', 'feat: add feature'),
    ];
    const result = processReverts(commits);
    expect(result).toEqual([]);
  });

  it('keeps standalone revert when original not in list', () => {
    const commits = [
      commit(
        'def456',
        'Revert "feat: old feature"',
        'This reverts commit oldsha.',
      ),
    ];
    const result = processReverts(commits);
    expect(result).toHaveLength(1);
    expect(result[0].hash).toBe('def456');
  });

  // Note: "current PR preview scenario" tests are covered by integration tests
  // in changelog-generate.test.ts under generateChangelogWithHighlight
});

describe('getNormalizedReleaseConfig semver warnings', () => {
  // These tests need to be in a separate file with proper module mocking
  // For now, we test the warning behavior through integration with the real config

  beforeEach(() => {
    // Clear the memoization cache and mocks before each test
    clearReleaseConfigCache();
    vi.clearAllMocks();
  });

  it('does not warn when using default config', async () => {
    const { logger } = await import('../../logger');

    // Uses real readReleaseConfig which returns defaults when no file exists
    getNormalizedReleaseConfig();

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('memoizes the result', async () => {
    // Call multiple times, should return same object
    const result1 = getNormalizedReleaseConfig();
    const result2 = getNormalizedReleaseConfig();
    const result3 = getNormalizedReleaseConfig();

    expect(result1).toBe(result2);
    expect(result2).toBe(result3);
  });

  it('returns fresh result after clearing cache', () => {
    const result1 = getNormalizedReleaseConfig();
    clearReleaseConfigCache();
    const result2 = getNormalizedReleaseConfig();

    // Should be equal but not the same object
    expect(result1).not.toBe(result2);
    expect(result1).toEqual(result2);
  });
});
