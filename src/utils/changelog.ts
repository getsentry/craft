import type { SimpleGit } from 'simple-git';
import { readFileSync } from 'fs';
import { join } from 'path';
import { load } from 'js-yaml';
import { logger } from '../logger';

import {
  getConfigFileDir,
  getGlobalGitHubConfig,
  getChangelogConfig,
} from '../config';
import { getChangesSince } from './git';
import { getGitHubClient } from './githubApi';
import { getVersion } from './version';

/** Information about the current (unmerged) PR to inject into changelog */
export interface CurrentPRInfo {
  number: number;
  title: string;
  body: string;
  author: string;
  labels: string[];
  /** Base branch ref (e.g., "master") for computing merge base */
  baseRef: string;
}

/**
 * Fetches PR details from GitHub API by PR number.
 *
 * @param prNumber The PR number to fetch
 * @returns PR info
 * @throws Error if PR cannot be fetched
 */
async function fetchPRInfo(prNumber: number): Promise<CurrentPRInfo> {
  const { repo, owner } = await getGlobalGitHubConfig();
  const github = getGitHubClient();

  const { data: pr } = await github.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
  });

  const { data: labels } = await github.issues.listLabelsOnIssue({
    owner,
    repo,
    issue_number: prNumber,
  });

  return {
    number: prNumber,
    title: pr.title,
    body: pr.body ?? '',
    author: pr.user?.login ?? '',
    labels: labels.map(l => l.name),
    baseRef: pr.base.ref,
  };
}

/**
 * Version bump types.
 */
export type BumpType = 'major' | 'minor' | 'patch';

/**
 * Version bump type priorities (lower number = higher priority).
 * Used for determining the highest bump type from commits.
 */
export const BUMP_TYPES: Map<BumpType, number> = new Map([
  ['major', 0],
  ['minor', 1],
  ['patch', 2],
]);

/**
 * Type guard to check if a string is a valid BumpType.
 */
export function isBumpType(value: string): value is BumpType {
  return BUMP_TYPES.has(value as BumpType);
}

/**
 * Path to the changelog file in the target repository
 */
export const DEFAULT_CHANGELOG_PATH = 'CHANGELOG.md';
export const DEFAULT_UNRELEASED_TITLE = 'Unreleased';
export const SKIP_CHANGELOG_MAGIC_WORD = '#skip-changelog';
export const BODY_IN_CHANGELOG_MAGIC_WORD = '#body-in-changelog';
const DEFAULT_CHANGESET_BODY = '- No documented changes.';
const VERSION_HEADER_LEVEL = 2;
const SUBSECTION_HEADER_LEVEL = VERSION_HEADER_LEVEL + 1;
const SCOPE_HEADER_LEVEL = SUBSECTION_HEADER_LEVEL + 1;
const MAX_COMMITS_PER_QUERY = 50;
const MAX_LEFTOVERS = 24;

// Ensure subsections are nested under version headers otherwise we won't be
// able to find them and put on GitHub releases.
if (SUBSECTION_HEADER_LEVEL <= VERSION_HEADER_LEVEL) {
  throw new Error('Subsection headers should nest under version headers!');
}
/**
 * A single changeset with name and description
 */
export interface Changeset {
  /** The name of this changeset */
  name: string;
  /** The markdown body describing the changeset */
  body: string;
}

/**
 * A changeset location based on RegExpExecArrays
 */
export interface ChangesetLoc {
  start: RegExpExecArray;
  end: RegExpExecArray | null;
  padding: string;
}

function escapeMarkdownPound(text: string): string {
  return text.replace(/#/g, '&#35;');
}

function markdownHeader(level: number, text: string): string {
  const prefix = new Array(level + 1).join('#');
  return `${prefix} ${escapeMarkdownPound(text)}`;
}

function escapeLeadingUnderscores(text: string): string {
  return text.replace(/(^| )_/, '$1\\_');
}

/**
 * Extracts the scope from a conventional commit title.
 * For example: "feat(api): add endpoint" returns "api"
 * Returns normalized scope (lowercase, dashes and underscores unified) or null if no scope found.
 */
export function extractScope(title: string): string | null {
  // Match conventional commit format: type(scope): message
  // Also handles breaking change indicator: type(scope)!: message
  const match = title.match(/^\w+\(([^)]+)\)!?:/);
  if (match && match[1]) {
    // Normalize: lowercase and replace dashes/underscores with a common separator
    return match[1].toLowerCase().replace(/[-_]/g, '-');
  }
  return null;
}

/**
 * Formats a scope name to title case for display.
 * Converts dashes and underscores to spaces, capitalizes first letter of each word.
 * For example: "my-component" becomes "My Component"
 */
export function formatScopeTitle(scope: string): string {
  return scope
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
}

/**
 * Represents a single changelog entry item, which may have nested sub-items
 */
export interface ChangelogEntryItem {
  /** The main text of the changelog entry */
  text: string;
  /** Optional nested content (e.g., sub-bullets) to be indented under this entry */
  nestedContent?: string;
}

/**
 * Extracts the "Changelog Entry" section from a PR description and parses it into structured entries.
 * This allows PR authors to override the default changelog entry (which is the PR title)
 * with custom text that's more user-facing and detailed.
 *
 * Looks for a markdown heading (either ### or ##) with the text "Changelog Entry"
 * and extracts the content until the next heading of the same or higher level.
 *
 * Parsing rules:
 * - Multiple top-level bullets (-, *, +) become separate changelog entries
 * - Plain text (no bullets) becomes a single entry
 * - Nested bullets are preserved as nested content under their parent entry
 * - Only content within the "Changelog Entry" section is included
 *
 * @param prBody The PR description/body text
 * @returns Array of changelog entry items, or null if no "Changelog Entry" section is found
 */
export function extractChangelogEntry(prBody: string | null | undefined): ChangelogEntryItem[] | null {
  if (!prBody) {
    return null;
  }

  // Match markdown headings (## or ###) followed by "Changelog Entry" (case-insensitive)
  // This matches both with and without the # at the end (e.g., "## Changelog Entry ##" or "## Changelog Entry")
  const headerRegex = /^#{2,3}\s+Changelog Entry\s*(?:#{2,3})?\s*$/im;
  const match = prBody.match(headerRegex);

  if (!match || match.index === undefined) {
    return null;
  }

  // Find the start of the content (after the heading line)
  const startIndex = match.index + match[0].length;
  const restOfBody = prBody.slice(startIndex);

  // Find the next heading of level 2 or 3 (## or ###)
  const nextHeaderMatch = restOfBody.match(/^#{2,3}\s+/m);
  const endIndex = nextHeaderMatch?.index ?? restOfBody.length;

  // Extract and trim the content
  const content = restOfBody.slice(0, endIndex).trim();

  // Return null if the section is empty
  if (!content) {
    return null;
  }

  // Parse the content into structured entries
  return parseChangelogContent(content);
}

/**
 * Parses changelog content into structured entries.
 * Handles multiple top-level bullets and nested content.
 */
function parseChangelogContent(content: string): ChangelogEntryItem[] {
  // First, check if the content has any bullet points at all
  const hasTopLevelBullets = /^(\s{0,3})[-*+]\s+/m.test(content);
  const hasIndentedBullets = /^(\s{4,}|\t+)[-*+]\s+/m.test(content);

  // If no bullets found at all, treat entire content as a single entry
  if (!hasTopLevelBullets && !hasIndentedBullets) {
    return [{
      text: content.trim(),
    }];
  }

  const lines = content.split('\n');
  const entries: ChangelogEntryItem[] = [];
  let currentEntry: ChangelogEntryItem | null = null;
  let nestedLines: string[] = [];

  for (const line of lines) {
    // Match top-level bullets (-, *, or + at the start of line, possibly with leading spaces)
    const topLevelBulletMatch = line.match(/^(\s{0,3})[-*+]\s+(.+)$/);

    if (topLevelBulletMatch) {
      // Save previous entry if exists
      if (currentEntry) {
        if (nestedLines.length > 0) {
          currentEntry.nestedContent = nestedLines.join('\n');
          nestedLines = [];
        }
        entries.push(currentEntry);
      }

      // Start new entry
      currentEntry = {
        text: topLevelBulletMatch[2].trim(),
      };
    } else if (currentEntry) {
      // Check if this is a nested bullet (more than 3 spaces of indentation, or tab)
      const nestedMatch = line.match(/^(\s{4,}|\t+)[-*+]\s+(.+)$/);
      if (nestedMatch) {
        nestedLines.push(`  ${nestedMatch[2].trim()}`);
      } else if (line.trim()) {
        // Non-empty line that's not a bullet - could be continuation text or nested content
        // Add to nested content if it has any indentation or follows other nested content
        if (nestedLines.length > 0 || line.match(/^\s+/)) {
          nestedLines.push(line.trimEnd());
        }
      }
    } else {
      // No current entry yet - check if this is a paragraph that might have nested bullets after it
      if (line.trim() && !line.match(/^(\s{4,}|\t+)[-*+]\s+/)) {
        // Non-indented, non-bullet line - start a new entry
        currentEntry = {
          text: line.trim(),
        };
      }
    }
  }

  // Save the last entry
  if (currentEntry) {
    if (nestedLines.length > 0) {
      currentEntry.nestedContent = nestedLines.join('\n');
    }
    entries.push(currentEntry);
  }

  // If we have indented bullets but no entries, treat entire content as a single entry
  if (entries.length === 0 && content.trim()) {
    return [{
      text: content.trim(),
    }];
  }

  return entries;
}

/**
 * Extracts a specific changeset from a markdown document
 *
 * The changes are bounded by a header preceding the changes and an optional
 * header at the end. If the latter is omitted, the markdown document will be
 * read until its end. The title of the changes will be extracted from the
 * given header.
 *
 * @param markdown The full changelog markdown
 * @param location The start & end location for the section
 * @returns The extracted changes
 */
function extractChangeset(markdown: string, location: ChangesetLoc): Changeset {
  const start = location.start.index + location.start[0].length;
  const end = location.end ? location.end.index : undefined;
  const body = markdown.substring(start, end).trim();
  const name = (location.start[2] || location.start[3])
    .replace(/\(.*\)$/, '')
    .trim();
  return { name, body };
}

/**
 * Locates and returns a changeset section with the title passed in header.
 * Supports an optional "predicate" callback used to compare the expected title
 * and the title found in text. Useful for normalizing versions.
 *
 * @param markdown The full changelog markdown
 * @param predicate A callback that takes the found title and returns true if
 *                  this is a match, false otherwise
 * @returns A ChangesetLoc object where "start" has the matche for the header,
 *          and "end" has the match for the next header so the contents
 *          inbetween can be extracted
 */
function locateChangeset(
  markdown: string,
  predicate: (match: string) => boolean
): ChangesetLoc | null {
  const HEADER_REGEX = new RegExp(
    `^( *)(?:#{${VERSION_HEADER_LEVEL}} +([^\\n]+?) *(?:#{${VERSION_HEADER_LEVEL}})?|([^\\n]+)\\n *(?:-){2,}) *(?:\\n+|$)`,
    'gm'
  );

  for (
    let match = HEADER_REGEX.exec(markdown);
    match !== null;
    match = HEADER_REGEX.exec(markdown)
  ) {
    const matchedTitle = match[2] || match[3];
    if (predicate(matchedTitle)) {
      const padSize = match?.[1]?.length || 0;
      return {
        end: HEADER_REGEX.exec(markdown),
        start: match,
        padding: new Array(padSize + 1).join(' '),
      };
    }
  }
  return null;
}

/**
 * Searches for a changeset within the given markdown
 *
 * We support two formats at the moment:
 *    ## 1.2.3
 * and
 *    1.2.3
 *    -----
 *
 * @param markdown The markdown containing the changeset
 * @param tag A git tag containing a version number
 * @param [fallbackToUnreleased=false] Whether to fallback to "unreleased" when
 *        tag is not found
 * @returns The changeset if found; otherwise null
 */
export function findChangeset(
  markdown: string,
  tag: string,
  fallbackToUnreleased = false
): Changeset | null {
  const version = getVersion(tag);
  if (version === null) {
    return null;
  }

  let changesetLoc = locateChangeset(
    markdown,
    match => getVersion(match) === version
  );
  if (!changesetLoc && fallbackToUnreleased) {
    changesetLoc = locateChangeset(
      markdown,
      match => match === DEFAULT_UNRELEASED_TITLE
    );
  }

  return changesetLoc ? extractChangeset(markdown, changesetLoc) : null;
}

/**
 * Removes a given changeset from the provided markdown and returns the modified markdown
 * @param markdown The markdown containing the changeset
 * @param header The header of the changeset to-be-removed
 * @returns The markdown string without the changeset with the provided header
 */
export function removeChangeset(markdown: string, header: string): string {
  const location = locateChangeset(markdown, match => match === header);
  if (!location) {
    return markdown;
  }

  const start = location.start.index;
  const end = location.end?.index ?? markdown.length;
  return markdown.slice(0, start) + markdown.slice(end);
}

/**
 * Prepends a changeset to the provided markdown text and returns the result.
 * It tries to prepend before the first ever changeset header, to keep any
 * higher-level content intact and in order. If none found, then the changeset
 * is *appended* instead.
 *
 * @param markdown The markdown that will be prepended
 * @param changeset The changeset data to prepend to
 * @returns The markdown string with the changeset prepedend before the top-most
 *          existing changeset.
 */
export function prependChangeset(
  markdown: string,
  changeset: Changeset
): string {
  // Try to locate the top-most non-empty header, no matter what is inside
  const { start, padding } = locateChangeset(markdown, Boolean) || {
    padding: '',
  };
  const body = changeset.body || `${padding}${DEFAULT_CHANGESET_BODY}`;
  let header;
  if (start?.[3]) {
    const underline = new Array(changeset.name.length + 1).join('-');
    header = `${changeset.name}\n${underline}`;
  } else {
    header = markdownHeader(VERSION_HEADER_LEVEL, changeset.name);
  }
  const newSection = `${padding}${header}\n\n${body.replace(
    /^/gm,
    padding
  )}\n\n`;
  const startIdx = start?.index ?? markdown.length;

  return markdown.slice(0, startIdx) + newSection + markdown.slice(startIdx);
}

interface PullRequest {
  author?: string;
  number: string;
  hash: string;
  body: string;
  title: string;
  /** Whether this entry should be highlighted in output */
  highlight?: boolean;
}

/**
 * Creates PullRequest entries from raw commit info, handling custom changelog entries.
 * If the PR body contains a "Changelog Entry" section, each entry becomes a separate PR entry.
 * Otherwise, a single entry is created using the PR title.
 *
 * @param raw Raw commit/PR info
 * @param defaultTitle The default title to use if no custom entries (usually PR title)
 * @param fallbackBody Optional fallback body to check for magic word (used for leftovers)
 * @returns Array of PullRequest entries
 */
function createPREntriesFromRaw(
  raw: {
    author?: string;
    pr?: string;
    hash: string;
    prBody?: string | null;
    highlight?: boolean;
  },
  defaultTitle: string,
  fallbackBody?: string
): PullRequest[] {
  const customEntries = extractChangelogEntry(raw.prBody);

  if (customEntries) {
    return customEntries.map(entry => ({
      author: raw.author,
      number: raw.pr ?? '',
      hash: raw.hash,
      body: entry.nestedContent ?? '',
      title: entry.text,
      highlight: raw.highlight,
    }));
  }

  // For default entries, only include body if it contains the magic word
  let body = '';
  if (raw.prBody?.includes(BODY_IN_CHANGELOG_MAGIC_WORD)) {
    body = raw.prBody;
  } else if (fallbackBody?.includes(BODY_IN_CHANGELOG_MAGIC_WORD)) {
    body = fallbackBody;
  }

  return [
    {
      author: raw.author,
      number: raw.pr ?? '',
      hash: raw.hash,
      body,
      title: defaultTitle,
      highlight: raw.highlight,
    },
  ];
}

interface Commit {
  author?: string;
  hash: string;
  title: string;
  body: string;
  hasPRinTitle: boolean;
  pr: string | null;
  prTitle?: string | null;
  prBody?: string | null;
  labels: string[];
  category: string | null;
  /** Whether this entry should be highlighted in output */
  highlight?: boolean;
}

/**
 * Raw commit/PR info before categorization.
 * This is the input to the categorization step.
 */
interface RawCommitInfo {
  hash: string;
  title: string;
  body: string;
  author?: string;
  pr?: string;
  prTitle?: string;
  prBody?: string;
  labels: string[];
  /** Whether this entry should be highlighted in output */
  highlight?: boolean;
}

/**
 * Valid semver bump types for auto-versioning
 */
export type SemverBumpType = 'major' | 'minor' | 'patch';

/**
 * Release configuration structure matching GitHub's release.yml format
 */
export interface ReleaseConfigCategory {
  title: string;
  labels?: string[];
  commit_patterns?: string[];
  /** Semver bump type when commits match this category (for auto-versioning) */
  semver?: SemverBumpType;
  exclude?: {
    labels?: string[];
    authors?: string[];
  };
}

export interface ReleaseConfig {
  changelog?: {
    exclude?: {
      labels?: string[];
      authors?: string[];
    };
    categories?: ReleaseConfigCategory[];
  };
}

/**
 * Default release configuration based on conventional commits
 * Used when .github/release.yml doesn't exist
 */
export const DEFAULT_RELEASE_CONFIG: ReleaseConfig = {
  changelog: {
    exclude: {
      labels: ['skip-changelog'],
    },
    categories: [
      {
        title: 'Breaking Changes 🛠',
        commit_patterns: ['^\\w+(?:\\([^)]+\\))?!:'],
        semver: 'major',
      },
      {
        title: 'New Features ✨',
        commit_patterns: ['^feat\\b'],
        semver: 'minor',
      },
      {
        title: 'Bug Fixes 🐛',
        commit_patterns: ['^fix\\b'],
        semver: 'patch',
      },
      {
        title: 'Documentation 📚',
        commit_patterns: ['^docs?\\b'],
        semver: 'patch',
      },
      {
        title: 'Build / dependencies / internal 🔧',
        commit_patterns: ['^(?:build|refactor|meta|chore|ci|ref|perf)\\b'],
        semver: 'patch',
      },
    ],
  },
};

/**
 * Normalized release config with Sets for efficient lookups
 * All fields are non-optional - use empty sets/arrays when not present
 */
export interface NormalizedReleaseConfig {
  changelog: {
    exclude: {
      labels: Set<string>;
      authors: Set<string>;
    };
    categories: NormalizedCategory[];
  };
}

export interface NormalizedCategory {
  title: string;
  labels: string[];
  commitLogPatterns: RegExp[];
  /** Semver bump type when commits match this category (for auto-versioning) */
  semver?: SemverBumpType;
  exclude: {
    labels: Set<string>;
    authors: Set<string>;
  };
}

type CategoryWithPRs = {
  title: string;
  scopeGroups: Map<string | null, PullRequest[]>;
};

/**
 * Reads and parses .github/release.yml from the repository root
 * @returns Parsed release configuration, or the default config if file doesn't exist
 */
export function readReleaseConfig(): ReleaseConfig {
  const configFileDir = getConfigFileDir();
  if (!configFileDir) {
    return DEFAULT_RELEASE_CONFIG;
  }

  const releaseConfigPath = join(configFileDir, '.github', 'release.yml');
  try {
    const fileContents = readFileSync(releaseConfigPath, 'utf8');
    const config = load(fileContents) as ReleaseConfig;
    return config;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      // File doesn't exist, return default config
      return DEFAULT_RELEASE_CONFIG;
    }
    logger.warn(
      `Failed to read release config from ${releaseConfigPath}:`,
      error
    );
    return DEFAULT_RELEASE_CONFIG;
  }
}

/**
 * Normalizes the release config by converting arrays to Sets and compiling regex patterns
 */
export function normalizeReleaseConfig(
  config: ReleaseConfig
): NormalizedReleaseConfig | null {
  if (!config?.changelog) {
    return null;
  }

  const normalized: NormalizedReleaseConfig = {
    changelog: {
      exclude: {
        labels: new Set<string>(),
        authors: new Set<string>(),
      },
      categories: [],
    },
  };

  if (config.changelog.exclude) {
    if (
      config.changelog.exclude.labels &&
      config.changelog.exclude.labels.length > 0
    ) {
      normalized.changelog.exclude.labels = new Set(
        config.changelog.exclude.labels
      );
    }
    if (
      config.changelog.exclude.authors &&
      config.changelog.exclude.authors.length > 0
    ) {
      normalized.changelog.exclude.authors = new Set(
        config.changelog.exclude.authors
      );
    }
  }

  if (Array.isArray(config.changelog.categories)) {
    normalized.changelog.categories = config.changelog.categories.map(
      category => {
        const normalizedCategory: NormalizedCategory = {
          title: category.title,
          labels:
            category.labels && category.labels.length > 0
              ? category.labels
              : [],
          commitLogPatterns: (category.commit_patterns || [])
            .map(pattern => {
              try {
                return new RegExp(pattern, 'i');
              } catch {
                logger.warn(
                  `Invalid regex pattern in release config: ${pattern}`
                );
                return null;
              }
            })
            .filter((r): r is RegExp => r !== null),
          semver: category.semver,
          exclude: {
            labels: new Set<string>(),
            authors: new Set<string>(),
          },
        };

        if (category.exclude) {
          if (category.exclude.labels && category.exclude.labels.length > 0) {
            normalizedCategory.exclude.labels = new Set(
              category.exclude.labels
            );
          }
          if (category.exclude.authors && category.exclude.authors.length > 0) {
            normalizedCategory.exclude.authors = new Set(
              category.exclude.authors
            );
          }
        }

        return normalizedCategory;
      }
    );
  }

  return normalized;
}

/**
 * Checks if a PR should be excluded globally based on:
 * 1. The #skip-changelog magic word in the body (commit body or PR body)
 * 2. Excluded labels from release config
 * 3. Excluded authors from release config
 *
 * @param labels Set of labels on the PR
 * @param author Author of the PR
 * @param config Normalized release config
 * @param body Optional body text to check for magic word
 * @returns true if the PR should be excluded
 */
export function shouldExcludePR(
  labels: Set<string>,
  author: string | undefined,
  config: NormalizedReleaseConfig | null,
  body?: string
): boolean {
  // Check for magic word in body
  if (body?.includes(SKIP_CHANGELOG_MAGIC_WORD)) {
    return true;
  }

  if (!config?.changelog) {
    return false;
  }

  const { exclude } = config.changelog;

  for (const excludeLabel of exclude.labels) {
    if (labels.has(excludeLabel)) {
      return true;
    }
  }

  if (author && exclude.authors.has(author)) {
    return true;
  }

  return false;
}

/**
 * Checks if the current PR should be skipped from the changelog entirely.
 * Convenience wrapper around shouldExcludePR that loads config automatically.
 *
 * @param prInfo The current PR info
 * @returns true if the PR should be skipped
 */
export function shouldSkipCurrentPR(prInfo: CurrentPRInfo): boolean {
  const rawConfig = readReleaseConfig();
  const releaseConfig = normalizeReleaseConfig(rawConfig);
  const labels = new Set(prInfo.labels);

  return shouldExcludePR(labels, prInfo.author, releaseConfig, prInfo.body);
}

/**
 * Determines the version bump type for a PR based on its labels and title.
 * This is used to determine the release version even for PRs that are
 * excluded from the changelog (e.g., via #skip-changelog).
 *
 * @param prInfo The current PR info
 * @returns The bump type (major, minor, patch) or null if no match
 */
export function getBumpTypeForPR(prInfo: CurrentPRInfo): BumpType | null {
  const rawConfig = readReleaseConfig();
  const releaseConfig = normalizeReleaseConfig(rawConfig);
  const labels = new Set(prInfo.labels);

  const matchedCategory = matchCommitToCategory(
    labels,
    prInfo.author,
    prInfo.title.trim(),
    releaseConfig
  );

  return matchedCategory?.semver ?? null;
}

/**
 * Checks if a category excludes the given PR based on labels and author
 */
export function isCategoryExcluded(
  category: NormalizedCategory,
  labels: Set<string>,
  author: string | undefined
): boolean {
  if (labels.size > 0) {
    for (const excludeLabel of category.exclude.labels) {
      if (labels.has(excludeLabel)) {
        return true;
      }
    }
  }

  if (author && category.exclude.authors.has(author)) {
    return true;
  }

  return false;
}

/**
 * Matches a PR's labels or commit title to a category from release config.
 * Labels take precedence over commit log pattern matching.
 * Category-level exclusions are checked here - they exclude the PR from matching this specific category,
 * allowing it to potentially match other categories or fall through to "Other"
 * @returns The matched category or null if no match or excluded from all categories
 */
export function matchCommitToCategory(
  labels: Set<string>,
  author: string | undefined,
  title: string,
  config: NormalizedReleaseConfig | null
): NormalizedCategory | null {
  if (!config?.changelog || config.changelog.categories.length === 0) {
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
    const matchesPattern = category.commitLogPatterns.some(re =>
      re.test(title)
    );
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

// This is set to 8 since GitHub and GitLab prefer that over the default 7 to
// avoid collisions.
const SHORT_SHA_LENGTH = 8;

interface ChangelogEntry {
  title: string;
  author?: string;
  prNumber?: string;
  hash: string;
  body?: string;
  /** Base URL for the repository, e.g. https://github.com/owner/repo */
  repoUrl: string;
  /** Whether this entry should be highlighted (rendered as blockquote) */
  highlight?: boolean;
}

/**
 * Formats a single changelog entry with consistent full markdown link format.
 * Format: `- Title by @author in [#123](pr-url)` or `- Title in [abcdef12](commit-url)`
 * When highlight is true, the entry is prefixed with `> ` (blockquote).
 */
function formatChangelogEntry(entry: ChangelogEntry): string {
  let title = entry.title;

  // Strip PR number suffix like "(#123)" since we add the link separately
  if (entry.prNumber) {
    const prSuffix = `(#${entry.prNumber})`;
    if (title.endsWith(prSuffix)) {
      title = title.slice(0, -prSuffix.length).trimEnd();
    }
  }
  title = escapeLeadingUnderscores(title);

  let text = `- ${title}`;

  if (entry.prNumber) {
    // Full markdown link format for PRs
    const prLink = `${entry.repoUrl}/pull/${entry.prNumber}`;
    if (entry.author) {
      text += ` by @${entry.author} in [#${entry.prNumber}](${prLink})`;
    } else {
      text += ` in [#${entry.prNumber}](${prLink})`;
    }
  } else {
    // Commits without PRs: link to commit
    const shortHash = entry.hash.slice(0, SHORT_SHA_LENGTH);
    const commitLink = `${entry.repoUrl}/commit/${entry.hash}`;
    if (entry.author) {
      text += ` by @${entry.author} in [${shortHash}](${commitLink})`;
    } else {
      text += ` in [${shortHash}](${commitLink})`;
    }
  }

  // Add body content
  // Two cases: 1) legacy magic word behavior, 2) nested content from structured changelog entries
  if (entry.body) {
    if (entry.body.includes(BODY_IN_CHANGELOG_MAGIC_WORD)) {
      // Legacy behavior: extract and format body with magic word
      const body = entry.body.replace(BODY_IN_CHANGELOG_MAGIC_WORD, '').trim();
      if (body) {
        text += `\n  ${body}`;
      }
    } else if (entry.body.trim()) {
      // New behavior: nested content from parsed changelog entries
      // Don't trim() before splitting to preserve indentation on all lines
      const lines = entry.body.split('\n');
      for (const line of lines) {
        // Each line already has the proper indentation from parsing
        text += `\n${line}`;
      }
    }
  }

  // Apply blockquote highlighting if requested
  if (entry.highlight) {
    text = text
      .split('\n')
      .map(line => `> ${line}`)
      .join('\n');
  }

  return text;
}

/**
 * Result of changelog generation, includes both the formatted changelog
 * and the determined version bump type based on commit categories.
 */
export interface ChangelogResult {
  /** The formatted changelog string */
  changelog: string;
  /** The highest version bump type found, or null if no commits matched categories with semver */
  bumpType: BumpType | null;
  /** Number of commits analyzed */
  totalCommits: number;
  /** Number of commits that matched a category with a semver field */
  matchedCommitsWithSemver: number;
  /** Whether the current PR was skipped (only set when using --pr flag) */
  prSkipped?: boolean;
}

/**
 * Raw changelog data before serialization to markdown.
 * This intermediate representation allows manipulation of entries
 * before final formatting.
 */
export interface RawChangelogData {
  /** Categories with their PR entries, keyed by category title */
  categories: Map<string, CategoryWithPRs>;
  /** Commits that didn't match any category */
  leftovers: Commit[];
  /** Release config for serialization */
  releaseConfig: NormalizedReleaseConfig | null;
}

/**
 * Statistics from changelog generation, used for auto-versioning.
 */
interface ChangelogStats {
  /** The highest version bump type found */
  bumpType: BumpType | null;
  /** Number of commits analyzed */
  totalCommits: number;
  /** Number of commits that matched a category with a semver field */
  matchedCommitsWithSemver: number;
}

/**
 * Result from raw changelog generation, includes both data and stats.
 */
interface RawChangelogResult {
  data: RawChangelogData;
  stats: ChangelogStats;
}

// Memoization cache for generateChangesetFromGit
// Caches promises to coalesce concurrent calls with the same arguments
const changesetCache = new Map<string, Promise<ChangelogResult>>();

function getChangesetCacheKey(rev: string, maxLeftovers: number): string {
  return `${rev}:${maxLeftovers}`;
}

/**
 * Clears the memoization cache for generateChangesetFromGit.
 * Primarily used for testing.
 */
export function clearChangesetCache(): void {
  changesetCache.clear();
}

export async function generateChangesetFromGit(
  git: SimpleGit,
  rev: string,
  maxLeftovers: number = MAX_LEFTOVERS
): Promise<ChangelogResult> {
  const cacheKey = getChangesetCacheKey(rev, maxLeftovers);

  // Return cached promise if available (coalesces concurrent calls)
  const cached = changesetCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Create and cache the promise
  const promise = generateChangesetFromGitImpl(git, rev, maxLeftovers);
  changesetCache.set(cacheKey, promise);

  return promise;
}

/**
 * Generates a changelog preview for a PR, showing how it will appear in the changelog.
 * This function:
 * 1. Fetches PR info from GitHub API (including base branch)
 * 2. Fetches all commit/PR info up to base branch
 * 3. Adds the current PR to the list with highlight flag
 * 4. Runs categorization on the combined list
 * 5. Serializes to markdown
 *
 * @param git Local git client
 * @param rev Base revision (tag or SHA) to generate changelog from
 * @param currentPRNumber PR number to fetch from GitHub and include (highlighted)
 * @returns The changelog result with formatted markdown
 */
export async function generateChangelogWithHighlight(
  git: SimpleGit,
  rev: string,
  currentPRNumber: number
): Promise<ChangelogResult> {
  // Step 1: Fetch PR info from GitHub
  const prInfo = await fetchPRInfo(currentPRNumber);

  // Step 2: Check if PR should be skipped - bypass changelog generation but still determine bump type
  if (shouldSkipCurrentPR(prInfo)) {
    // Even skipped PRs contribute to version bumping based on their title
    const bumpType = getBumpTypeForPR(prInfo);

    return {
      changelog: '',
      bumpType,
      totalCommits: 1,
      matchedCommitsWithSemver: bumpType ? 1 : 0,
      prSkipped: true,
    };
  }

  // Step 3: Fetch the base branch to get current state
  await git.fetch('origin', prInfo.baseRef);
  const baseRef = `origin/${prInfo.baseRef}`;
  logger.debug(`Using PR base branch "${prInfo.baseRef}" for changelog`);

  // Step 4: Fetch raw commit info up to base branch
  const rawCommits = await fetchRawCommitInfo(git, rev, baseRef);

  // Step 5: Add current PR to the list with highlight flag (at the beginning)
  const currentPRCommit: RawCommitInfo = {
    hash: '',
    title: prInfo.title.trim(),
    body: prInfo.body,
    author: prInfo.author,
    pr: String(prInfo.number),
    prTitle: prInfo.title,
    prBody: prInfo.body,
    labels: prInfo.labels,
    highlight: true,
  };
  const allCommits = [currentPRCommit, ...rawCommits];

  // Step 6: Run categorization on combined list
  const { data: rawData, stats } = categorizeCommits(allCommits);

  // Step 7: Serialize to markdown
  const changelog = await serializeChangelog(rawData, MAX_LEFTOVERS);

  return {
    changelog,
    prSkipped: false,
    ...stats,
  };
}

/**
 * Fetches raw commit/PR info from git history and GitHub.
 * This is the first step - just gathering data, no categorization.
 *
 * @param git Local git client
 * @param rev Base revision (tag or SHA) to start from
 * @param until Optional end revision (defaults to HEAD)
 * @returns Array of raw commit info
 */
async function fetchRawCommitInfo(
  git: SimpleGit,
  rev: string,
  until?: string
): Promise<RawCommitInfo[]> {
  // Early filter: skip commits with magic word in commit body (optimization to avoid GitHub API calls)
  const gitCommits = (await getChangesSince(git, rev, until)).filter(
    ({ body }) => !body.includes(SKIP_CHANGELOG_MAGIC_WORD)
  );

  const githubCommits = await getPRAndLabelsFromCommit(
    gitCommits.map(({ hash }) => hash)
  );

  // Note: PR body magic word check is handled by shouldExcludePR in categorizeCommits
  return gitCommits.map(gitCommit => {
    const githubCommit = githubCommits[gitCommit.hash];
    return {
      hash: gitCommit.hash,
      title: gitCommit.title,
      body: gitCommit.body,
      author: githubCommit?.author,
      pr: githubCommit?.pr ?? gitCommit.pr ?? undefined,
      prTitle: githubCommit?.prTitle ?? undefined,
      prBody: githubCommit?.prBody ?? undefined,
      labels: githubCommit?.labels ?? [],
    };
  });
}

/**
 * Categorizes raw commits into changelog structure.
 * This is the second step - grouping by category and scope.
 *
 * @param rawCommits Array of raw commit info to categorize
 * @returns Categorized changelog data and stats
 */
function categorizeCommits(rawCommits: RawCommitInfo[]): RawChangelogResult {
  const rawConfig = readReleaseConfig();
  const releaseConfig = normalizeReleaseConfig(rawConfig);

  const categories = new Map<string, CategoryWithPRs>();
  const leftovers: Commit[] = [];
  const missing: RawCommitInfo[] = [];

  // Track bump type for auto-versioning (lower priority value = higher bump)
  let bumpPriority: number | null = null;
  let matchedCommitsWithSemver = 0;

  for (const raw of rawCommits) {
    const labels = new Set(raw.labels);
    // Use PR body if available, otherwise use commit body for skip-changelog check
    const bodyToCheck = raw.prBody ?? raw.body;

    if (shouldExcludePR(labels, raw.author, releaseConfig, bodyToCheck)) {
      continue;
    }

    // Use PR title if available, otherwise use commit title for pattern matching
    const titleForMatching = (raw.prTitle ?? raw.title).trim();
    const matchedCategory = matchCommitToCategory(
      labels,
      raw.author,
      titleForMatching,
      releaseConfig
    );
    const categoryTitle = matchedCategory?.title ?? null;

    // Track bump type if category has semver field
    if (matchedCategory?.semver) {
      const priority = BUMP_TYPES.get(matchedCategory.semver);
      if (priority !== undefined) {
        matchedCommitsWithSemver++;
        bumpPriority = Math.min(bumpPriority ?? priority, priority);
      }
    }

    // Track commits not found on GitHub (for warning)
    if (!raw.pr && raw.hash) {
      missing.push(raw);
    }

    if (!categoryTitle || !raw.pr) {
      // No category match or no PR - goes to leftovers
      leftovers.push({
        author: raw.author,
        hash: raw.hash,
        title: raw.title,
        body: raw.body,
        hasPRinTitle: Boolean(raw.pr),
        pr: raw.pr ?? null,
        prTitle: raw.prTitle ?? null,
        prBody: raw.prBody ?? null,
        labels: raw.labels,
        category: categoryTitle,
        highlight: raw.highlight,
      });
    } else {
      // Has category and PR - add to category
      let category = categories.get(categoryTitle);
      if (!category) {
        category = {
          title: categoryTitle,
          scopeGroups: new Map<string | null, PullRequest[]>(),
        };
        categories.set(categoryTitle, category);
      }

      const prTitle = (raw.prTitle ?? raw.title).trim();
      const scope = extractScope(prTitle);

      let scopeGroup = category.scopeGroups.get(scope);
      if (!scopeGroup) {
        scopeGroup = [];
        category.scopeGroups.set(scope, scopeGroup);
      }

      // Create PR entries (handles custom changelog entries if present)
      const prEntries = createPREntriesFromRaw(raw, prTitle, raw.body);
      scopeGroup.push(...prEntries);
    }
  }

  // Convert priority back to bump type
  let bumpType: BumpType | null = null;
  if (bumpPriority !== null) {
    for (const [type, priority] of BUMP_TYPES) {
      if (priority === bumpPriority) {
        bumpType = type;
        break;
      }
    }
  }

  if (missing.length > 0) {
    logger.warn(
      'The following commits were not found on GitHub:',
      missing.map(c => `${c.hash.slice(0, 8)} ${c.title}`)
    );
  }

  return {
    data: {
      categories,
      leftovers,
      releaseConfig,
    },
    stats: {
      bumpType,
      totalCommits: rawCommits.length,
      matchedCommitsWithSemver,
    },
  };
}

/**
 * Generates raw changelog data from git history.
 * Convenience function that fetches commits and categorizes them.
 *
 * @param git Local git client
 * @param rev Base revision (tag or SHA) to generate changelog from
 * @param until Optional end revision (defaults to HEAD)
 * @returns Raw changelog data structure
 */
async function generateRawChangelog(
  git: SimpleGit,
  rev: string,
  until?: string
): Promise<RawChangelogResult> {
  const rawCommits = await fetchRawCommitInfo(git, rev, until);
  return categorizeCommits(rawCommits);
}

/**
 * Serializes raw changelog data to markdown format.
 * Entries with `highlight: true` are rendered as blockquotes.
 *
 * @param rawData The raw changelog data to serialize
 * @param maxLeftovers Maximum number of leftover entries to include
 * @returns Formatted markdown changelog string
 */
async function serializeChangelog(
  rawData: RawChangelogData,
  maxLeftovers: number
): Promise<string> {
  const { categories, leftovers, releaseConfig } = rawData;

  const changelogSections: string[] = [];
  const { repo, owner } = await getGlobalGitHubConfig();
  const repoUrl = `https://github.com/${owner}/${repo}`;

  // Get changelog config for scope grouping setting
  let scopeGroupingEnabled = true;
  try {
    const changelogConfig = getChangelogConfig();
    scopeGroupingEnabled = changelogConfig.scopeGrouping;
  } catch {
    // If config can't be read (e.g., no .craft.yml), use default
  }

  // Sort categories by the order defined in release config
  const categoryOrder =
    releaseConfig?.changelog?.categories?.map(c => c.title) ?? [];
  const sortedCategories = [...categories.entries()].sort((a, b) => {
    const aIndex = categoryOrder.indexOf(a[1].title);
    const bIndex = categoryOrder.indexOf(b[1].title);
    // Categories in config come first, sorted by config order
    // Categories not in config go to the end (maintain insertion order)
    const aOrder = aIndex === -1 ? Infinity : aIndex;
    const bOrder = bIndex === -1 ? Infinity : bIndex;
    return aOrder - bOrder;
  });

  for (const [, category] of sortedCategories) {
    if (category.scopeGroups.size === 0) {
      continue;
    }

    changelogSections.push(
      markdownHeader(SUBSECTION_HEADER_LEVEL, category.title)
    );

    // Sort scope groups: scoped entries first (alphabetically), scopeless (null) last
    const sortedScopes = [...category.scopeGroups.entries()].sort((a, b) => {
      const [scopeA] = a;
      const [scopeB] = b;
      // null (no scope) goes last
      if (scopeA === null && scopeB === null) return 0;
      if (scopeA === null) return 1;
      if (scopeB === null) return -1;
      // Sort alphabetically
      return scopeA.localeCompare(scopeB);
    });

    // Check if any scope has multiple entries (would get a header)
    const hasScopeHeaders = [...category.scopeGroups.entries()].some(
      ([s, entries]) => s !== null && entries.length > 1
    );

    // Collect entries without headers to combine them into a single section
    const entriesWithoutHeaders: string[] = [];

    for (const [scope, prs] of sortedScopes) {
      const prEntries = prs.map(pr =>
        formatChangelogEntry({
          title: pr.title,
          author: pr.author,
          prNumber: pr.number,
          hash: pr.hash,
          body: pr.body,
          repoUrl,
          highlight: pr.highlight,
        })
      );

      // Determine scope header:
      // - Scoped entries with multiple PRs get formatted scope title
      // - Scopeless entries get "Other" header when other scope headers exist
      // - Otherwise no header (entries collected for later)
      let scopeHeader: string | null = null;
      if (scopeGroupingEnabled) {
        if (scope !== null && prs.length > 1) {
          scopeHeader = formatScopeTitle(scope);
        } else if (scope === null && hasScopeHeaders) {
          scopeHeader = 'Other';
        }
      }

      if (scopeHeader) {
        changelogSections.push(markdownHeader(SCOPE_HEADER_LEVEL, scopeHeader));
        changelogSections.push(prEntries.join('\n'));
      } else {
        // No header for this scope group - collect entries to combine later
        entriesWithoutHeaders.push(...prEntries);
      }
    }

    // Push all entries without headers as a single section to avoid extra newlines
    if (entriesWithoutHeaders.length > 0) {
      changelogSections.push(entriesWithoutHeaders.join('\n'));
    }
  }

  const nLeftovers = leftovers.length;
  if (nLeftovers > 0) {
    // Only add "Other" section header if there are other category sections
    if (changelogSections.length > 0) {
      changelogSections.push(markdownHeader(SUBSECTION_HEADER_LEVEL, 'Other'));
    }
    const leftoverEntries: string[] = [];
    for (const commit of leftovers.slice(0, maxLeftovers)) {
      // Create PR entries (handles custom changelog entries if present)
      const prEntries = createPREntriesFromRaw(
        {
          author: commit.author,
          pr: commit.pr ?? undefined,
          hash: commit.hash,
          prBody: commit.prBody,
          highlight: commit.highlight,
        },
        (commit.prTitle ?? commit.title).trim(),
        commit.body // fallback for magic word check
      );

      for (const pr of prEntries) {
        leftoverEntries.push(
          formatChangelogEntry({
            title: pr.title,
            author: pr.author,
            prNumber: pr.number || undefined,
            hash: pr.hash,
            repoUrl,
            body: pr.body || undefined,
            highlight: pr.highlight,
          })
        );
      }
    }
    changelogSections.push(leftoverEntries.join('\n'));
    if (nLeftovers > maxLeftovers) {
      changelogSections.push(`_Plus ${nLeftovers - maxLeftovers} more_`);
    }
  }

  return changelogSections.join('\n\n');
}

/**
 * Implementation of changelog generation that uses the new architecture.
 * Generates raw data, then serializes to markdown.
 */
async function generateChangesetFromGitImpl(
  git: SimpleGit,
  rev: string,
  maxLeftovers: number
): Promise<ChangelogResult> {
  const { data: rawData, stats } = await generateRawChangelog(git, rev);
  const changelog = await serializeChangelog(rawData, maxLeftovers);

  return {
    changelog,
    ...stats,
  };
}

interface CommitInfo {
  author: {
    user?: { login: string };
  };
  associatedPullRequests: {
    nodes: Array<{
      number: string;
      title: string;
      body: string;
      author?: {
        login: string;
      };
      labels: {
        nodes: Array<{
          name: string;
        }>;
      };
    }>;
  };
}

interface CommitInfoMap {
  [hash: string]: CommitInfo | null;
}

interface CommitInfoResult {
  repository: CommitInfoMap;
}

export async function getPRAndLabelsFromCommit(hashes: string[]): Promise<
  Record<
    /* hash */ string,
    {
      author?: string;
      pr: string | null;
      prTitle: string | null;
      prBody: string | null;
      labels: string[];
    }
  >
> {
  if (hashes.length === 0) {
    return {};
  }

  // Make query in chunks where each chunk has 50 commit hashes
  // Otherwise GitHub keeps timing out
  const commitInfo: CommitInfoMap = {};
  const chunkCount = Math.ceil(hashes.length / MAX_COMMITS_PER_QUERY);
  for (let chunk = 0; chunk < chunkCount; chunk += 1) {
    const subset = hashes.slice(
      chunk * MAX_COMMITS_PER_QUERY,
      (chunk + 1) * MAX_COMMITS_PER_QUERY
    );

    const commitsQuery = subset
      // We need to prefix the hash value (with `C` here) when using it as an
      // alias as aliases cannot start with a number but hashes can.
      .map(hash => `C${hash}: object(oid: "${hash}") {...PRFragment}`)
      .join('\n');

    const { repo, owner } = await getGlobalGitHubConfig();
    const graphqlQuery = `{
      repository(name: "${repo}", owner: "${owner}") {
        ${commitsQuery}
      }
    }

    fragment PRFragment on Commit {
      author {
        user { login }
      }
      associatedPullRequests(first: 1) {
        nodes {
          author {
            login
          }
          number
          title
          body
          labels(first: 50) {
            nodes {
              name
            }
          }
        }
      }
    }`;
    logger.trace('Running graphql query:', graphqlQuery);
    Object.assign(
      commitInfo,
      ((await getGitHubClient().graphql(graphqlQuery)) as CommitInfoResult)
        .repository
    );
    logger.trace('Query result:', commitInfo);
  }

  return Object.fromEntries(
    Object.entries(commitInfo).map(([hash, commit]) => {
      const pr = commit?.associatedPullRequests.nodes[0];
      return [
        // Strip the prefix on the hash we used to workaround in GraphQL
        hash.slice(1),
        pr
          ? {
              author: pr.author?.login,
              pr: pr.number,
              prTitle: pr.title,
              prBody: pr.body,
              labels: pr.labels?.nodes?.map(label => label.name) ?? [],
            }
          : {
              author: commit?.author.user?.login,
              pr: null,
              prTitle: null,
              prBody: null,
              labels: [],
            },
      ];
    })
  );
}
