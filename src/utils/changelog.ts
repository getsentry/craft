import type { SimpleGit } from 'simple-git';
import { readFileSync } from 'fs';
import { join } from 'path';
import { load } from 'js-yaml';
import { logger } from '../logger';

import { getConfigFileDir, getGlobalGitHubConfig } from '../config';
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
  author: string;
  number: string;
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
  exclude: {
    labels: Set<string>;
    authors: Set<string>;
  };
}

type CategoryWithPRs = {
  title: string;
  prs: PullRequest[];
};

/**
 * Reads and parses .github/release.yml from the repository root
 * @returns Parsed release configuration or null if file doesn't exist
 */
function readReleaseConfig(): ReleaseConfig | null {
  const configFileDir = getConfigFileDir();
  if (!configFileDir) {
    return null;
  }

  const releaseConfigPath = join(configFileDir, '.github', 'release.yml');
  try {
    const fileContents = readFileSync(releaseConfigPath, 'utf8');
    const config = load(fileContents) as ReleaseConfig;
    return config;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      // File doesn't exist, return null
      return null;
    }
    logger.warn(`Failed to read release config from ${releaseConfigPath}:`, error);
    return null;
  }
}

/**
 * Normalizes the release config by converting arrays to Sets and normalizing empty arrays
 */
function normalizeReleaseConfig(config: ReleaseConfig | null): NormalizedReleaseConfig | null {
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
    if (config.changelog.exclude.labels && config.changelog.exclude.labels.length > 0) {
      normalized.changelog.exclude.labels = new Set(config.changelog.exclude.labels);
    }
    if (config.changelog.exclude.authors && config.changelog.exclude.authors.length > 0) {
      normalized.changelog.exclude.authors = new Set(config.changelog.exclude.authors);
    }
  }

  if (config.changelog.categories) {
    normalized.changelog.categories = config.changelog.categories.map(category => {
      const normalizedCategory: NormalizedCategory = {
        title: category.title,
        labels: category.labels && category.labels.length > 0 ? category.labels : [],
        exclude: {
          labels: new Set<string>(),
          authors: new Set<string>(),
        },
      };

      if (category.exclude) {
        if (category.exclude.labels && category.exclude.labels.length > 0) {
          normalizedCategory.exclude.labels = new Set(category.exclude.labels);
        }
        if (category.exclude.authors && category.exclude.authors.length > 0) {
          normalizedCategory.exclude.authors = new Set(category.exclude.authors);
        }
      }

      return normalizedCategory;
    });
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
 * Matches a PR's labels to a category from release config
 * Category-level exclusions are checked here - they exclude the PR from matching this specific category,
 * allowing it to potentially match other categories or fall through to "Other"
 * @returns Category title or null if no match or excluded from this category
 */
function matchPRToCategory(
  labels: Set<string>,
  author: string | undefined,
  config: NormalizedReleaseConfig | null
): string | null {
  if (!config?.changelog || config.changelog.categories.length === 0) {
    return null;
  }

  const regularCategories: NormalizedCategory[] = [];
  let wildcardCategory: NormalizedCategory | null = null;

  for (const category of config.changelog.categories) {
    if (category.labels.length === 0) {
      continue;
    }

    if (category.labels.includes('*')) {
      wildcardCategory = category;
      continue;
    }

    regularCategories.push(category);
  }

  categoryLoop: for (const category of regularCategories) {
    const matchesCategory = category.labels.some(label => labels.has(label));

    if (!matchesCategory) {
      continue;
    }

    for (const excludeLabel of category.exclude.labels) {
      if (labels.has(excludeLabel)) {
        continue categoryLoop;
      }
    }

    if (author && category.exclude.authors.has(author)) {
      continue categoryLoop;
    }

    return category.title;
  }

  if (wildcardCategory) {
    if (wildcardCategory.exclude.labels.intersection(labels).size > 0) {
      return null;
    }

    if (author && wildcardCategory.exclude.authors.has(author)) {
      return null;
    }

    return wildcardCategory.title;
  }

  return null;
}

// This is set to 8 since GitHub and GitLab prefer that over the default 7 to
// avoid collisions.
const SHORT_SHA_LENGTH = 8;
function formatCommit(commit: Commit): string {
  let text = `- ${escapeLeadingUnderscores(commit.title)}`;
  if (!commit.hasPRinTitle) {
    const link = commit.pr
      ? `#${commit.pr}`
      : commit.hash.slice(0, SHORT_SHA_LENGTH);
    text = `${text} (${link})`;
  }
  if (commit.author) {
    text = `${text} by @${commit.author}`;
  }
  let body = '';
  if (commit.prBody?.includes(BODY_IN_CHANGELOG_MAGIC_WORD)) {
    body = commit.prBody;
  } else if (commit.body.includes(BODY_IN_CHANGELOG_MAGIC_WORD)) {
    body = commit.body;
  }
  body = body.replace(BODY_IN_CHANGELOG_MAGIC_WORD, '');
  if (body) {
    text += `\n  ${body}`;
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

    const categoryTitle = matchPRToCategory(labels, author, releaseConfig);

    const commit: Commit = {
      author: author,
      hash: hash,
      title: gitCommit.title,
      body: gitCommit.body,
      hasPRinTitle: Boolean(gitCommit.pr),
      pr: githubCommit?.pr ?? null,
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
      if (!commit.pr || !commit.author) {
        leftovers.push(commit);
      } else {
        let category = categories.get(categoryTitle);
        if (!category) {
          category = {
            title: categoryTitle,
            prs: [] as PullRequest[],
          };
          categories.set(categoryTitle, category);
        }
        category.prs.push({
          author: commit.author,
          number: commit.pr,
          body: commit.prBody ?? '',
          title: commit.title,
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
  const prLinkBase = `https://github.com/${owner}/${repo}/pull`;

  for (const [, category] of categories.entries()) {
    if (category.prs.length === 0) {
      continue;
    }

    changelogSections.push(
      markdownHeader(SUBSECTION_HEADER_LEVEL, category.title)
    );

    const prEntries = category.prs.map(pr => {
      const prLink = `${prLinkBase}/${pr.number}`;
      const prTitle = escapeLeadingUnderscores(pr.title);
      let entry = `- ${prTitle} by @${pr.author} in [#${pr.number}](${prLink})`;
      
      if (pr.body?.includes(BODY_IN_CHANGELOG_MAGIC_WORD)) {
        const body = pr.body.replace(BODY_IN_CHANGELOG_MAGIC_WORD, '').trim();
        if (body) {
          entry += `\n  ${body}`;
        }
      }
      
      return entry;
    });

    changelogSections.push(prEntries.join('\n'));
  }

  const nLeftovers = leftovers.length;
  if (nLeftovers > 0) {
    // Only add "Other" section header if there are other category sections
    if (changelogSections.length > 0) {
      changelogSections.push(
        markdownHeader(SUBSECTION_HEADER_LEVEL, 'Other')
      );
    }
    changelogSections.push(
      leftovers.slice(0, maxLeftovers).map(formatCommit).join('\n')
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

async function getPRAndLabelsFromCommit(
  hashes: string[]
): Promise<
  Record<
    /* hash */ string,
    {
      author?: string;
      pr: string | null;
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
              prBody: pr.body,
              labels: pr.labels?.nodes?.map(label => label.name) ?? [],
            }
          : {
              author: commit?.author.user?.login,
              pr: null,
              prBody: null,
              labels: [],
            },
      ];
    })
  );
}

