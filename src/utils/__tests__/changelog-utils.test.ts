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

