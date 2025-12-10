import * as semver from 'semver';
import type { SimpleGit } from 'simple-git';

import { logger } from '../logger';
import { getChangesSince } from './git';
import {
  readReleaseConfig,
  normalizeReleaseConfig,
  getPRAndLabelsFromCommit,
  shouldExcludePR,
  isCategoryExcluded,
  SKIP_CHANGELOG_MAGIC_WORD,
  type NormalizedReleaseConfig,
  type NormalizedCategory,
  type SemverBumpType,
} from './changelog';

/**
 * Enum representing version bump types with numeric values for comparison.
 * Higher values indicate more significant changes.
 * Using numeric values allows for easy max comparison and early exit.
 */
export enum BumpType {
  Patch = 1,
  Minor = 2,
  Major = 3,
}

/**
 * Maps semver bump type strings to BumpType enum values
 */
const SEMVER_TO_BUMP_TYPE: Record<SemverBumpType, BumpType> = {
  patch: BumpType.Patch,
  minor: BumpType.Minor,
  major: BumpType.Major,
};

/**
 * Maps BumpType enum values back to semver release type strings
 */
const BUMP_TYPE_TO_SEMVER: Record<BumpType, semver.ReleaseType> = {
  [BumpType.Patch]: 'patch',
  [BumpType.Minor]: 'minor',
  [BumpType.Major]: 'major',
};

/**
 * Matches a commit/PR to a category and returns the category's semver bump type.
 * Labels take precedence over commit log pattern matching.
 *
 * @returns The matched category with its semver bump type, or null if no match
 */
function matchCommitToCategory(
  labels: Set<string>,
  author: string | undefined,
  title: string,
  config: NormalizedReleaseConfig
): NormalizedCategory | null {
  if (config.changelog.categories.length === 0) {
    return null;
  }

  const regularCategories: NormalizedCategory[] = [];
  let wildcardCategory: NormalizedCategory | null = null;

  for (const category of config.changelog.categories) {
    // A category is valid if it has labels OR commit_patterns
    if (
      category.labels.length === 0 &&
      category.commitLogPatterns.length === 0
    ) {
      continue;
    }

    if (category.labels.includes('*')) {
      wildcardCategory = category;
      continue;
    }

    regularCategories.push(category);
  }

  // First pass: try label matching (skip if no labels)
  if (labels.size > 0) {
    for (const category of regularCategories) {
      const matchesCategory = category.labels.some(label => labels.has(label));
      if (matchesCategory && !isCategoryExcluded(category, labels, author)) {
        return category;
      }
    }
  }

  // Second pass: try commit_patterns matching
  for (const category of regularCategories) {
    const matchesPattern = category.commitLogPatterns.some(re => re.test(title));
    if (matchesPattern && !isCategoryExcluded(category, labels, author)) {
      return category;
    }
  }

  if (wildcardCategory) {
    if (isCategoryExcluded(wildcardCategory, labels, author)) {
      return null;
    }
    return wildcardCategory;
  }

  return null;
}

/**
 * Result of analyzing commits for version bump determination
 */
export interface BumpAnalysisResult {
  /** The highest bump type found, or null if no commits matched categories with semver */
  bumpType: BumpType | null;
  /** Number of commits analyzed */
  totalCommits: number;
  /** Number of commits that matched a category with a semver field */
  matchedCommits: number;
}

/**
 * Analyzes commits to determine the highest version bump type needed.
 * Uses early exit optimization - returns immediately when Major bump is found.
 *
 * @param git The SimpleGit instance
 * @param rev The revision (tag) to start from
 * @returns Analysis result with bump type and commit counts
 */
export async function analyzeCommitsForBump(
  git: SimpleGit,
  rev: string
): Promise<BumpAnalysisResult> {
  const rawConfig = readReleaseConfig();
  const releaseConfig = normalizeReleaseConfig(rawConfig);

  if (!releaseConfig) {
    return { bumpType: null, totalCommits: 0, matchedCommits: 0 };
  }

  // Get commits since the last tag
  const gitCommits = (await getChangesSince(git, rev)).filter(
    ({ body }) => !body.includes(SKIP_CHANGELOG_MAGIC_WORD)
  );

  if (gitCommits.length === 0) {
    return { bumpType: null, totalCommits: 0, matchedCommits: 0 };
  }

  // Fetch PR metadata from GitHub for label matching
  const githubCommits = await getPRAndLabelsFromCommit(
    gitCommits.map(({ hash }) => hash)
  );

  let maxBumpType: BumpType | null = null;
  let matchedCommits = 0;

  for (const gitCommit of gitCommits) {
    const hash = gitCommit.hash;
    const githubCommit = githubCommits[hash];

    // Skip if PR body contains skip magic word
    if (githubCommit?.prBody?.includes(SKIP_CHANGELOG_MAGIC_WORD)) {
      continue;
    }

    const labelsArray = githubCommit?.labels ?? [];
    const labels = new Set(labelsArray);
    const author = githubCommit?.author;

    // Skip if globally excluded
    if (shouldExcludePR(labels, author, releaseConfig)) {
      continue;
    }

    // Use PR title if available, otherwise use commit title for pattern matching
    const titleForMatching = githubCommit?.prTitle ?? gitCommit.title;
    const matchedCategory = matchCommitToCategory(
      labels,
      author,
      titleForMatching,
      releaseConfig
    );

    // Only count commits that match a category with a semver field
    if (matchedCategory?.semver) {
      matchedCommits++;
      const bumpType = SEMVER_TO_BUMP_TYPE[matchedCategory.semver];

      // Update max if this is higher
      if (maxBumpType === null || bumpType > maxBumpType) {
        maxBumpType = bumpType;

        // Early exit: if we found a major bump, no need to continue
        if (maxBumpType === BumpType.Major) {
          logger.debug(
            `Found major bump trigger in commit ${hash.slice(0, 8)}: "${titleForMatching}"`
          );
          break;
        }
      }
    }
  }

  return {
    bumpType: maxBumpType,
    totalCommits: gitCommits.length,
    matchedCommits,
  };
}

/**
 * Calculates the next version by applying the bump type to the current version.
 *
 * @param currentVersion The current version string (e.g., "1.2.3")
 * @param bumpType The type of bump to apply
 * @returns The new version string
 * @throws Error if the version cannot be incremented
 */
export function calculateNextVersion(
  currentVersion: string,
  bumpType: BumpType
): string {
  // Handle empty/missing current version (new project)
  const versionToBump = currentVersion || '0.0.0';

  const releaseType = BUMP_TYPE_TO_SEMVER[bumpType];
  const newVersion = semver.inc(versionToBump, releaseType);

  if (!newVersion) {
    throw new Error(
      `Failed to increment version "${versionToBump}" with bump type "${releaseType}"`
    );
  }

  return newVersion;
}

/**
 * Automatically determines the version bump type based on conventional commits.
 *
 * @param git The SimpleGit instance
 * @param rev The revision (tag) to analyze from
 * @returns The determined bump type
 * @throws Error if no commits match categories with semver fields
 */
export async function getAutoBumpType(
  git: SimpleGit,
  rev: string
): Promise<BumpType> {
  logger.info(
    `Analyzing commits since ${rev || '(beginning of history)'} for auto-versioning...`
  );

  const analysis = await analyzeCommitsForBump(git, rev);

  if (analysis.totalCommits === 0) {
    throw new Error(
      'Cannot determine version automatically: no commits found since the last release.'
    );
  }

  if (analysis.bumpType === null) {
    throw new Error(
      `Cannot determine version automatically: ${analysis.totalCommits} commit(s) found, ` +
        'but none matched a category with a "semver" field in the release configuration. ' +
        'Please ensure your .github/release.yml categories have "semver" fields defined, ' +
        'or specify the version explicitly.'
    );
  }

  const bumpTypeName = BUMP_TYPE_TO_SEMVER[analysis.bumpType];
  logger.info(
    `Auto-version: determined ${bumpTypeName} bump ` +
      `(${analysis.matchedCommits}/${analysis.totalCommits} commits matched)`
  );

  return analysis.bumpType;
}
