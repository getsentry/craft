import * as semver from 'semver';
import type { SimpleGit } from 'simple-git';

import { logger } from '../logger';
import {
  generateChangesetFromGit,
  BUMP_TYPES,
  type BumpType,
  type ChangelogResult,
} from './changelog';

// Re-export for convenience
export { BUMP_TYPES, type BumpType, type ChangelogResult };

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
 * Automatically determines the version bump type based on conventional commits.
 * This reuses the changelog generation logic to avoid duplicate work.
 *
 * @param git The SimpleGit instance
 * @param rev The revision (tag) to analyze from
 * @returns The changelog result containing both changelog and bump type
 * @throws Error if no commits match categories with semver fields
 */
export async function getChangelogWithBumpType(
  git: SimpleGit,
  rev: string
): Promise<ChangelogResult> {
  logger.info(
    `Analyzing commits since ${rev || '(beginning of history)'} for auto-versioning...`
  );

  const result = await generateChangesetFromGit(git, rev);

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

  logger.info(
    `Auto-version: determined ${result.bumpType} bump ` +
      `(${result.matchedCommitsWithSemver}/${result.totalCommits} commits matched)`
  );

  return result;
}
