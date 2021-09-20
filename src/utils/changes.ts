import { SimpleGit } from 'simple-git';
import { logger } from '../logger';

import { getGlobalGithubConfig } from '../config';
import { getChangesSince } from '../utils/git';
import { getGithubClient } from '../utils/githubApi';
import { getVersion } from './version';

/**
 * Path to the changelog file in the target repository
 */
export const DEFAULT_CHANGELOG_PATH = 'CHANGELOG.md';
export const DEFAULT_UNRELEASED_TITLE = 'Unreleased';
const DEFAULT_CHANGESET_BODY = '- No documented changes.';

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
  const HEADER_REGEX = /^( *)(?:## +([^\n]+?) *(?:##)?|([^\n]+)\n *(?:-){2,}) *(?:\n+|$)/gm;

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
    header = `## ${changeset.name}`;
  }
  const newSection = `${padding}${header}\n\n${body.replace(
    /^/gm,
    padding
  )}\n\n`;
  const startIdx = start?.index ?? markdown.length;

  return markdown.slice(0, startIdx) + newSection + markdown.slice(startIdx);
}

interface Commit {
  hash: string;
  title: string;
  hasPRinTitle: boolean;
  pr: string | null;
  milestone: string | null;
}

interface Milestone {
  title?: string;
  description?: string;
  state?: string;
  prs: string[];
}

// This is set to 8 since GitHub and GitLab prefer that over the default 7 to
// avoid collisions.
const SHORT_SHA_LENGTH = 8;
function formatCommit(commit: Commit): string {
  let text = `- ${commit.title}`;
  if (!commit.hasPRinTitle) {
    const link = commit.pr
      ? `#${commit.pr}`
      : commit.hash.slice(0, SHORT_SHA_LENGTH);
    text = `${text} (${link})`;
  }
  return text;
}

export async function generateChangesetFromGit(
  git: SimpleGit,
  rev: string
): Promise<string> {
  const { repo, owner } = await getGlobalGithubConfig();
  const gitCommits = await getChangesSince(git, rev);
  const commitsQuery = gitCommits
    .map(({ hash }) => `C${hash}: object(oid: "${hash}") {...PRFragment}`)
    .join('\n');

  const github = getGithubClient();
  const { repository: githubCommits } = await github.graphql(`{
    repository(name: "${repo}", owner: "${owner}") {
      ${commitsQuery}
    }
  }

  fragment PRFragment on Commit {
    associatedPullRequests(first: 1) {
      nodes {
        number
        milestone {
          number
        }
      }
    }
  }`);

  const milestones: {
    [number: string]: Milestone;
  } = {};
  const commits: {
    [hash: string]: Commit;
  } = {};
  const leftovers: Commit[] = [];
  const missing: Commit[] = [];
  for (const gitCommit of gitCommits) {
    const hash = gitCommit.hash;

    const commit = (commits[hash] = {
      hash: hash,
      title: gitCommit.message,
      pr: gitCommit.pr,
      hasPRinTitle: Boolean(gitCommit.pr),
      milestone: null,
    });
    const commitInfo = githubCommits[`C${hash}`];
    if (commitInfo) {
      const pr = commitInfo.associatedPullRequests.nodes[0];
      if (pr) {
        commit.pr = pr.number;
        commit.milestone = pr.milestone?.number;
      }
    } else {
      missing.push(commit);
    }

    const milestoneNum = commit.milestone;
    if (milestoneNum != null) {
      const milestone = milestones[milestoneNum] || { prs: [] };
      // We _know_ the PR exists as milestones are attached to PRs
      milestone.prs.push(commit.pr as string);
      milestones[milestoneNum] = milestone;
    } else {
      leftovers.push(commit);
    }
  }

  if (missing.length > 0) {
    logger.warn(
      `The following commits were not found on GitHub:`,
      missing.map(commit => `${commit.hash.slice(0, 8)} ${commit.title}`)
    );
  }

  const milestoneQuery = Object.keys(milestones)
    .map(
      number =>
        `M${number}: milestone(number: ${number}) { ...MilestoneFragment }`
    )
    .join('\n');

  const { repository: milestonesInfo } = await github.graphql(`{
    repository(name: "${repo}", owner: "${owner}") {
      ${milestoneQuery}
    }
  }

    fragment MilestoneFragment on Milestone {
      title
      description
      state
    }
  `);

  const changelogSections = [];
  for (const milestoneNum of Object.keys(milestones)) {
    const milestoneInfo = milestonesInfo[`M${milestoneNum}`];
    if (milestoneInfo == null) {
      // XXX(BYK): This case should never happen in real life
      throw new Error(`Cannot get information for milestone #${milestoneNum}`);
    }

    changelogSections.push(
      `## ${milestoneInfo.title}${
        milestoneInfo.state === 'OPEN' ? ' (ongoing)' : ''
      }`
    );
    changelogSections.push(milestoneInfo.description);
    changelogSections.push(
      `PRs: ${milestones[milestoneNum].prs.map(pr => `#${pr}`).join(', ')}`
    );
  }

  changelogSections.push(`## Various fixes & improvements`);
  changelogSections.push(leftovers.map(formatCommit).join('\n'));

  return changelogSections.join('\n\n');
}
