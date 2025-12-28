import { vi, type Mock, type MockInstance, type Mocked, type MockedFunction } from 'vitest';
/**
 * Tests for changelog utility functions.
 * - shouldExcludePR: Checks if a PR should be excluded from changelog
 * - shouldSkipCurrentPR: Checks if current PR should skip changelog generation
 * - getBumpTypeForPR: Determines the version bump type for a PR
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
  SKIP_CHANGELOG_MAGIC_WORD,
  BODY_IN_CHANGELOG_MAGIC_WORD,
  type CurrentPRInfo,
} from '../changelog';

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
    expect(shouldExcludePR(
      new Set(['bug', 'skip-changelog']),
      'alice',
      baseConfig as any,
      ''
    )).toBe(true);
  });

  it('returns true when PR has excluded author', () => {
    expect(shouldExcludePR(
      new Set(['bug']),
      'dependabot',
      baseConfig as any,
      ''
    )).toBe(true);
  });

  it('returns false when PR has no exclusion criteria', () => {
    expect(shouldExcludePR(
      new Set(['bug']),
      'alice',
      baseConfig as any,
      ''
    )).toBe(false);
  });

  it('returns true when body contains skip magic word', () => {
    expect(shouldExcludePR(
      new Set(['bug']),
      'alice',
      baseConfig as any,
      `Some text\n${SKIP_CHANGELOG_MAGIC_WORD}\nMore text`
    )).toBe(true);
  });

  it('returns false when config is null', () => {
    expect(shouldExcludePR(
      new Set(['bug']),
      'alice',
      null,
      ''
    )).toBe(false);
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
  };

  it('returns false when PR has no skip magic word', () => {
    expect(shouldSkipCurrentPR(basePRInfo)).toBe(false);
  });

  it('returns true when PR body contains skip magic word', () => {
    const prInfo = { ...basePRInfo, body: `Some text\n${SKIP_CHANGELOG_MAGIC_WORD}` };
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
        'Add endpoint'
      );
    });

    it('strips type and scope when preserveScope is false', () => {
      expect(stripTitle('feat(api): add endpoint', pattern, false)).toBe(
        'Add endpoint'
      );
    });

    it('preserves scope when preserveScope is true', () => {
      expect(stripTitle('feat(api): add endpoint', pattern, true)).toBe(
        '(api) Add endpoint'
      );
    });

    it('capitalizes first letter after stripping', () => {
      expect(stripTitle('feat: lowercase start', pattern, false)).toBe(
        'Lowercase start'
      );
    });

    it('handles already capitalized content', () => {
      expect(stripTitle('feat: Already Capitalized', pattern, false)).toBe(
        'Already Capitalized'
      );
    });

    it('does not strip if no type match', () => {
      expect(stripTitle('random title', pattern, false)).toBe('random title');
    });

    it('handles breaking change indicator', () => {
      const breakingPattern = /^(?<type>feat(?:\((?<scope>[^)]+)\))?!:\s*)/;
      expect(stripTitle('feat!: breaking change', breakingPattern, false)).toBe(
        'Breaking change'
      );
      expect(
        stripTitle('feat(api)!: breaking api change', breakingPattern, false)
      ).toBe('Breaking api change');
    });

    it('does not strip when pattern has no type group', () => {
      const noGroupPattern = /^feat(?:\([^)]+\))?!?:\s*/;
      expect(stripTitle('feat: add endpoint', noGroupPattern, false)).toBe(
        'feat: add endpoint'
      );
    });
  });

  describe('edge cases', () => {
    const pattern = /^(?<type>feat(?:\((?<scope>[^)]+)\))?!?:\s*)/;

    it('returns original if pattern is undefined', () => {
      expect(stripTitle('feat: add endpoint', undefined, false)).toBe(
        'feat: add endpoint'
      );
    });

    it('does not strip if nothing remains after stripping', () => {
      const exactPattern = /^(?<type>feat:\s*)$/;
      expect(stripTitle('feat: ', exactPattern, false)).toBe('feat: ');
    });

    it('handles scope with special characters', () => {
      expect(stripTitle('feat(my-api): add endpoint', pattern, true)).toBe(
        '(my-api) Add endpoint'
      );
      expect(stripTitle('feat(my_api): add endpoint', pattern, true)).toBe(
        '(my_api) Add endpoint'
      );
    });

    it('does not preserve scope when scope is not captured', () => {
      const noScopePattern = /^(?<type>feat(?:\([^)]+\))?!?:\s*)/;
      expect(stripTitle('feat(api): add endpoint', noScopePattern, true)).toBe(
        'Add endpoint'
      );
    });
  });

  describe('with different commit types', () => {
    it('works with fix type', () => {
      const pattern = /^(?<type>fix(?:\((?<scope>[^)]+)\))?!?:\s*)/;
      expect(stripTitle('fix(core): resolve bug', pattern, false)).toBe(
        'Resolve bug'
      );
      expect(stripTitle('fix(core): resolve bug', pattern, true)).toBe(
        '(core) Resolve bug'
      );
    });

    it('works with docs type', () => {
      const pattern = /^(?<type>docs?(?:\((?<scope>[^)]+)\))?!?:\s*)/;
      expect(stripTitle('docs(readme): update docs', pattern, false)).toBe(
        'Update docs'
      );
      expect(stripTitle('doc(readme): update docs', pattern, false)).toBe(
        'Update docs'
      );
    });

    it('works with build/chore types', () => {
      const pattern =
        /^(?<type>(?:build|refactor|meta|chore|ci|ref|perf)(?:\((?<scope>[^)]+)\))?!?:\s*)/;
      expect(stripTitle('chore(deps): update deps', pattern, false)).toBe(
        'Update deps'
      );
      expect(stripTitle('build(ci): fix pipeline', pattern, false)).toBe(
        'Fix pipeline'
      );
      expect(stripTitle('refactor(api): simplify logic', pattern, true)).toBe(
        '(api) Simplify logic'
      );
    });
  });
});
