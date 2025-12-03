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
}

/**
 * Release configuration structure matching GitHub's release.yml format
 */
interface ReleaseConfigCategory {
  title: string;
  labels?: string[];
  commit_patterns?: string[];
  exclude?: {
    labels?: string[];
    authors?: string[];
  };
}

interface ReleaseConfig {
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
const DEFAULT_RELEASE_CONFIG: ReleaseConfig = {
  changelog: {
    categories: [
      {
        title: 'Breaking Changes 🛠',
        commit_patterns: ['^\\w+(?:\\([^)]+\\))?!:'],
      },
      {
        title: 'New Features ✨',
        commit_patterns: ['^feat\\b'],
      },
      {
        title: 'Bug Fixes 🐛',
        commit_patterns: ['^fix\\b'],
      },
      {
        title: 'Documentation 📚',
        commit_patterns: ['^docs?\\b'],
      },
      {
        title: 'Build / dependencies / internal 🔧',
        commit_patterns: ['^(?:build|refactor|meta|chore|ci)\\b'],
      },
    ],
  },
};

/**
 * Normalized release config with Sets for efficient lookups
 * All fields are non-optional - use empty sets/arrays when not present
 */
interface NormalizedReleaseConfig {
  changelog: {
    exclude: {
      labels: Set<string>;
      authors: Set<string>;
    };
    categories: NormalizedCategory[];
  };
}

interface NormalizedCategory {
  title: string;
  labels: string[];
  commitLogPatterns: RegExp[];
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
function readReleaseConfig(): ReleaseConfig {
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
function normalizeReleaseConfig(
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
 * Checks if a PR should be excluded globally based on release config
 */
function shouldExcludePR(
  labels: Set<string>,
  author: string | undefined,
  config: NormalizedReleaseConfig | null
): boolean {
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
 * Checks if a category excludes the given PR based on labels and author
 */
function isCategoryExcluded(
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
 * Matches a PR's labels or commit title to a category from release config
 * Labels take precedence over commit log pattern matching.
 * Category-level exclusions are checked here - they exclude the PR from matching this specific category,
 * allowing it to potentially match other categories or fall through to "Other"
 * @returns Category title or null if no match or excluded from this category
 */
function matchPRToCategory(
  labels: Set<string>,
  author: string | undefined,
  title: string,
  config: NormalizedReleaseConfig | null
): string | null {
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
        return category.title;
      }
    }
  }

  // Second pass: try commit_patterns matching
  for (const category of regularCategories) {
    const matchesPattern = category.commitLogPatterns.some(re =>
      re.test(title)
    );
    if (matchesPattern && !isCategoryExcluded(category, labels, author)) {
      return category.title;
    }
  }

  if (wildcardCategory) {
    if (isCategoryExcluded(wildcardCategory, labels, author)) {
      return null;
    }
    return wildcardCategory.title;
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
}

/**
 * Formats a single changelog entry with consistent full markdown link format.
 * Format: `- Title by @author in [#123](pr-url)` or `- Title in [abcdef12](commit-url)`
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

  // Add body if magic word is present
  if (entry.body?.includes(BODY_IN_CHANGELOG_MAGIC_WORD)) {
    const body = entry.body.replace(BODY_IN_CHANGELOG_MAGIC_WORD, '').trim();
    if (body) {
      text += `\n  ${body}`;
    }
  }

  return text;
}

export async function generateChangesetFromGit(
  git: SimpleGit,
  rev: string,
  maxLeftovers: number = MAX_LEFTOVERS
): Promise<string> {
  const rawConfig = readReleaseConfig();
  const releaseConfig = normalizeReleaseConfig(rawConfig);

  const gitCommits = (await getChangesSince(git, rev)).filter(
    ({ body }) => !body.includes(SKIP_CHANGELOG_MAGIC_WORD)
  );

  const githubCommits = await getPRAndLabelsFromCommit(
    gitCommits.map(({ hash }) => hash)
  );

  const categories = new Map<string, CategoryWithPRs>();
  const commits: Record</*hash*/ string, Commit> = {};
  const leftovers: Commit[] = [];
  const missing: Commit[] = [];

  for (const gitCommit of gitCommits) {
    const hash = gitCommit.hash;

    const githubCommit = githubCommits[hash];
    if (githubCommit?.prBody?.includes(SKIP_CHANGELOG_MAGIC_WORD)) {
      continue;
    }

    const labelsArray = githubCommit?.labels ?? [];
    const labels = new Set(labelsArray);
    const author = githubCommit?.author;

    if (shouldExcludePR(labels, author, releaseConfig)) {
      continue;
    }

    // Use PR title if available, otherwise use commit title for pattern matching
    const titleForMatching = githubCommit?.prTitle ?? gitCommit.title;
    const categoryTitle = matchPRToCategory(
      labels,
      author,
      titleForMatching,
      releaseConfig
    );

    const commit: Commit = {
      author: author,
      hash: hash,
      title: gitCommit.title,
      body: gitCommit.body,
      hasPRinTitle: Boolean(gitCommit.pr),
      // Use GitHub PR number, falling back to locally parsed PR from title
      pr: githubCommit?.pr ?? gitCommit.pr ?? null,
      prTitle: githubCommit?.prTitle ?? null,
      prBody: githubCommit?.prBody ?? null,
      labels: labelsArray,
      category: categoryTitle,
    };
    commits[hash] = commit;

    if (!githubCommit) {
      missing.push(commit);
    }

    if (!categoryTitle) {
      leftovers.push(commit);
    } else {
      if (!commit.pr) {
        leftovers.push(commit);
      } else {
        let category = categories.get(categoryTitle);
        if (!category) {
          category = {
            title: categoryTitle,
            scopeGroups: new Map<string | null, PullRequest[]>(),
          };
          categories.set(categoryTitle, category);
        }

        // Extract and normalize scope from PR title
        const prTitle = commit.prTitle ?? commit.title;
        const scope = extractScope(prTitle);

        // Get or create the scope group
        let scopeGroup = category.scopeGroups.get(scope);
        if (!scopeGroup) {
          scopeGroup = [];
          category.scopeGroups.set(scope, scopeGroup);
        }

        scopeGroup.push({
          author: commit.author,
          number: commit.pr,
          hash: commit.hash,
          body: commit.prBody ?? '',
          title: prTitle,
        });
      }
    }
  }

  if (missing.length > 0) {
    logger.warn(
      'The following commits were not found on GitHub:',
      missing.map(commit => `${commit.hash.slice(0, 8)} ${commit.title}`)
    );
  }

  const changelogSections = [];
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
    releaseConfig?.changelog.categories.map(c => c.title) ?? [];
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

    for (const [scope, prs] of sortedScopes) {
      // Add scope header if:
      // - scope grouping is enabled AND
      // - scope exists (not null) AND
      // - there's more than one entry in this scope (single entry headers aren't useful)
      if (scopeGroupingEnabled && scope !== null && prs.length > 1) {
        changelogSections.push(
          markdownHeader(SCOPE_HEADER_LEVEL, formatScopeTitle(scope))
        );
      }

      const prEntries = prs.map(pr =>
        formatChangelogEntry({
          title: pr.title,
          author: pr.author,
          prNumber: pr.number,
          hash: pr.hash,
          body: pr.body,
          repoUrl,
        })
      );

      changelogSections.push(prEntries.join('\n'));
    }
  }

  const nLeftovers = leftovers.length;
  if (nLeftovers > 0) {
    // Only add "Other" section header if there are other category sections
    if (changelogSections.length > 0) {
      changelogSections.push(markdownHeader(SUBSECTION_HEADER_LEVEL, 'Other'));
    }
    changelogSections.push(
      leftovers
        .slice(0, maxLeftovers)
        .map(commit =>
          formatChangelogEntry({
            title: commit.prTitle ?? commit.title,
            author: commit.author,
            prNumber: commit.pr ?? undefined,
            hash: commit.hash,
            repoUrl,
            // Check both prBody and commit body for the magic word
            body: commit.prBody?.includes(BODY_IN_CHANGELOG_MAGIC_WORD)
              ? commit.prBody
              : commit.body.includes(BODY_IN_CHANGELOG_MAGIC_WORD)
              ? commit.body
              : undefined,
          })
        )
        .join('\n')
    );
    if (nLeftovers > maxLeftovers) {
      changelogSections.push(`_Plus ${nLeftovers - maxLeftovers} more_`);
    }
  }

  return changelogSections.join('\n\n');
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

async function getPRAndLabelsFromCommit(hashes: string[]): Promise<
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
