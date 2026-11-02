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
  config: CalVerConfig,
): Promise<string> {
  // Calculate date with offset
  const date = new Date();
  date.setDate(date.getDate() - config.offset);

  // Format date part
  const datePart = formatCalVerDate(date, config.format);

  logger.debug(
    `CalVer: using date ${date.toISOString()}, date part: ${datePart}`,
  );

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

const CALVER_TOKEN_PATTERNS: Record<string, string> = {
  Y: '(\\d{4})',
  y: '(\\d{2})',
  m: '(\\d{2})',
  '-m': '(\\d{1,2})',
  d: '(\\d{2})',
  '-d': '(\\d{1,2})',
};

/**
 * Returns the first version of the CalVer period after the one `version`
 * belongs to. The period is the smallest unit in `format`: with `%y.%-m`,
 * `26.10.1` gives `26.11.0` and `26.12.3` gives `27.1.0`.
 *
 * @param version A CalVer version in the `{datePart}.{patch}` form
 * @param format The strftime-like format of the date part
 * @returns The next period's first version, or undefined if `version` doesn't
 * match `format`
 */
export function getNextCalVerPeriod(
  version: string,
  format: string,
): string | undefined {
  const tokens: string[] = [];
  const datePattern = format
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/%(Y|y|-m|m|-d|d)/g, (_match, token: string) => {
      tokens.push(token);
      return CALVER_TOKEN_PATTERNS[token];
    });
  const match = new RegExp(`^${datePattern}\\.\\d+$`).exec(version);
  if (!match || tokens.length === 0) {
    return undefined;
  }

  let year = 0;
  let month = 1;
  let day = 1;
  tokens.forEach((token, index) => {
    const value = Number(match[index + 1]);
    if (token === 'Y') {
      year = value;
    } else if (token === 'y') {
      year = 2000 + value;
    } else if (token.endsWith('m')) {
      month = value;
    } else {
      day = value;
    }
  });

  const date = new Date(year, month - 1, day);
  if (tokens.some(token => token.endsWith('d'))) {
    date.setDate(date.getDate() + 1);
  } else if (tokens.some(token => token.endsWith('m'))) {
    date.setMonth(date.getMonth() + 1);
  } else {
    date.setFullYear(date.getFullYear() + 1);
  }
  return `${formatCalVerDate(date, format)}.0`;
}
