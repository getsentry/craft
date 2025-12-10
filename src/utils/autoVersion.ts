import * as semver from 'semver';
import type { SimpleGit } from 'simple-git';

import { logger } from '../logger';
import {
  generateChangesetFromGit,
  BUMP_TYPES,
  isBumpType,
  type BumpType,
  type ChangelogResult,
} from './changelog';

// Re-export for convenience
export { BUMP_TYPES, isBumpType, type BumpType, type ChangelogResult };

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

  const newVersion = semver.inc(versionToBump, bumpType);

  if (!newVersion) {
    throw new Error(
      `Failed to increment version "${versionToBump}" with bump type "${bumpType}"`
    );
  }

  return newVersion;
}

/**
 * Generates changelog and determines version bump type from commits.
 * This is a convenience wrapper around generateChangesetFromGit that logs progress.
 *
 * @param git The SimpleGit instance
 * @param rev The revision (tag) to analyze from
 * @returns The changelog result (bumpType may be null if no matching commits)
 */
export async function getChangelogWithBumpType(
  git: SimpleGit,
  rev: string
): Promise<ChangelogResult> {
  logger.info(
    `Analyzing commits since ${rev || '(beginning of history)'} for auto-versioning...`
  );

  const result = await generateChangesetFromGit(git, rev);

  if (result.bumpType) {
    logger.info(
      `Auto-version: determined ${result.bumpType} bump ` +
        `(${result.matchedCommitsWithSemver}/${result.totalCommits} commits matched)`
    );
  }

  return result;
}

/**
 * Validates that a changelog result has the required bump type for auto-versioning.
 *
 * @param result The changelog result to validate
 * @throws Error if no commits found or none match categories with semver fields
 */
export function validateBumpType(result: ChangelogResult): asserts result is ChangelogResult & { bumpType: BumpType } {
  if (result.totalCommits === 0) {
    throw new Error(
      'Cannot determine version automatically: no commits found since the last release.'
    );
  }

  if (result.bumpType === null) {
    throw new Error(
      `Cannot determine version automatically: ${result.totalCommits} commit(s) found, ` +
        'but none matched a category with a "semver" field in the release configuration. ' +
        'Please ensure your .github/release.yml categories have "semver" fields defined, ' +
        'or specify the version explicitly.'
    );
  }
}
