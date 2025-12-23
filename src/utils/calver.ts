import type { SimpleGit } from 'simple-git';

import { getGitTagPrefix } from '../config';
import { logger } from '../logger';

/**
 * Configuration for CalVer versioning
 */
export interface CalVerConfig {
  /** Days to go back for date calculation */
  offset: number;
  /** strftime-like format for date part */
  format: string;
}

/**
 * Default CalVer configuration
 */
export const DEFAULT_CALVER_CONFIG: CalVerConfig = {
  offset: 14,
  format: '%y.%-m',
};

/**
 * Formats a date according to a strftime-like format string.
 *
 * Supported format specifiers:
 * - %y: 2-digit year (e.g., "24" for 2024)
 * - %Y: 4-digit year (e.g., "2024")
 * - %m: Zero-padded month (e.g., "01" for January)
 * - %-m: Month without zero padding (e.g., "1" for January)
 * - %d: Zero-padded day (e.g., "05")
 * - %-d: Day without zero padding (e.g., "5")
 *
 * @param date The date to format
 * @param format The format string
 * @returns The formatted date string
 */
export function formatCalVerDate(date: Date, format: string): string {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();

  return format
    .replace('%Y', String(year))
    .replace('%y', String(year).slice(-2))
    .replace('%-m', String(month))
    .replace('%m', String(month).padStart(2, '0'))
    .replace('%-d', String(day))
    .replace('%d', String(day).padStart(2, '0'));
}

/**
 * Calculates the next CalVer version based on existing tags.
 *
 * The version format is: {datePart}.{patch}
 * For example, with format '%y.%-m' and no existing tags: "24.12.0"
 *
 * @param git SimpleGit instance for checking existing tags
 * @param config CalVer configuration
 * @returns The next CalVer version string
 */
export async function calculateCalVer(
  git: SimpleGit,
  config: CalVerConfig
): Promise<string> {
  // Calculate date with offset
  const date = new Date();
  date.setDate(date.getDate() - config.offset);

  // Format date part
  const datePart = formatCalVerDate(date, config.format);

  logger.debug(`CalVer: using date ${date.toISOString()}, date part: ${datePart}`);

  // Find existing tags and determine next patch version
  // Account for git tag prefix (e.g., 'v') when searching
  const gitTagPrefix = getGitTagPrefix();
  const searchPrefix = `${gitTagPrefix}${datePart}.`;

  logger.debug(`CalVer: searching for tags with prefix: ${searchPrefix}`);

  const tags = await git.tags();
  let patch = 0;

  // Find the highest patch version for this date part
  for (const tag of tags.all) {
    if (tag.startsWith(searchPrefix)) {
      const patchStr = tag.slice(searchPrefix.length);
      const patchNum = parseInt(patchStr, 10);
      if (!isNaN(patchNum) && patchNum >= patch) {
        patch = patchNum + 1;
      }
    }
  }

  const version = `${datePart}.${patch}`;
  logger.info(`CalVer: determined version ${version}`);

  return version;
}
