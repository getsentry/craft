import {
  simpleGit,
  type SimpleGit,
  type LogOptions,
  type Options,
  type StatusResult,
} from 'simple-git';

import {
  getActiveWorkspace,
  getChangelogConfig,
  getConfigFileDir,
  getWorkspaceNames,
} from '../config';
import { ConfigurationError } from './errors';
import { createDryRunGit } from './dryRun';
import { logger } from '../logger';
import { distance as levenshtein } from 'fastest-levenshtein';
import path from 'node:path';
import { discoverWorkspaces } from './workspaces';

export interface GitChange {
  hash: string;
  title: string;
  body: string;
  pr: string | null;
}

// This regex relies on the default GitHub behavior where it appends the PR
// number to the end of the commit title as: `fix: Commit title (#123)`.
// This makes it very cheap and quick to extract the associated PR number just
// from the commit log locally.
// If this fails at some future, we can always revert back to using the GitHub
// API that gives you the PRs associated with a commit:
// https://docs.github.com/en/rest/commits/commits#list-pull-requests-associated-with-a-commit
export const PRExtractor = /(?<=\(#)\d+(?=\)$)/;

export const defaultInitialTag = '0.0.0';

export async function getDefaultBranch(
  git: SimpleGit,
  remoteName: string,
): Promise<string> {
  // Verify the remote exists before attempting to contact it, so we can
  // surface a clear error instead of a raw git exit-code-128 failure.
  const remotes = await git.getRemotes(false);
  if (!remotes.some(r => r.name === remoteName)) {
    throw new ConfigurationError(
      `Remote '${remoteName}' is not configured in this repository. ` +
        `Ensure the repository has a remote named '${remoteName}' before running craft.`,
    );
  }

  // This part is courtesy of https://stackoverflow.com/a/62397081/90297
  return stripRemoteName(
    await git
      .remote(['set-head', remoteName, '--auto'])
      .revparse(['--abbrev-ref', `${remoteName}/HEAD`]),
    remoteName,
  );
}

export async function getLatestTag(
  git: SimpleGit,
  tagPrefix = '',
): Promise<string> {
  try {
    // This part is courtesy of https://stackoverflow.com/a/7261049/90297
    const args = ['describe', '--tags', '--abbrev=0'];
    if (tagPrefix) {
      // In a monorepo, tags for multiple products (e.g. `cli@1.2.3`,
      // `mcp@2.0.0`) are interleaved. `--match '<prefix>*'` scopes
      // `git describe` to a single product's tag namespace so the latest tag
      // is resolved per-product instead of picking whatever is newest overall.
      args.push('--match', `${tagPrefix}*`);
    }
    return (await git.raw(args)).trim();
  } catch (err) {
    // If there are no tags, return an empty string
    if (
      err instanceof Error &&
      (err.message.startsWith('fatal: No names found') ||
        err.message.startsWith('Nothing to describe'))
    ) {
      return '';
    }
    throw err;
  }
}

export async function getChangesSince(
  git: SimpleGit,
  rev: string,
  until?: string,
): Promise<GitChange[]> {
  const gitLogArgs: Options | LogOptions = {
    to: until || 'HEAD',
    // The symmetric option defaults to true, giving us all the different commits
    // reachable from both `from` and `to` whereas what we are interested in is only the ones
    // reachable from `to` and _not_ from `from` so we get a "changelog" kind of list.
    // One is `A - B` and the other is more like `A XOR B`. We want `A - B`.
    // See https://github.com/steveukx/git-js#git-log and
    // https://git-scm.com/docs/gitrevisions#_dotted_range_notations for more
    symmetric: false,
    '--no-merges': null,
    // Limit changes to the CWD to better support monorepos
    // this should still return all commits for individual repos when run from
    // the repo root.
    file: '.',
  };

  // simple-git interprets `to` without `from` as HEAD..HEAD and returns no
  // commits. A first release has no previous tag, so log the full history.
  const { all: commits } = rev
    ? await git.log({ ...gitLogArgs, from: rev })
    : await git.log(['--no-merges', until || 'HEAD', '--', '.']);
  const changes = commits.map(commit => ({
    hash: commit.hash,
    title: commit.message,
    body: commit.body,
    pr: commit.message.match(PRExtractor)?.[0] || null,
  }));
  const workspace = getActiveWorkspace();
  if (!workspace || changes.length === 0) {
    return changes;
  }

  const root = getConfigFileDir() || process.cwd();
  const discovered = await discoverWorkspaces(root);
  const ownedPaths = new Set(getWorkspaceNames());
  for (const pkg of discovered.packages) {
    const relative = path
      .relative(root, pkg.location)
      .split(path.sep)
      .join('/');
    if (relative === '' || relative === '..' || relative.startsWith('../')) {
      throw new ConfigurationError(
        `Workspace package is outside the repository: ${pkg.name}`,
      );
    }
    ownedPaths.add(relative);
  }
  const orderedOwners = [...ownedPaths].sort(
    (left, right) => right.length - left.length,
  );
  const { includePaths } = getChangelogConfig();
  const contains = (directory: string, file: string) =>
    file === directory || file.startsWith(`${directory}/`);

  // NUL-delimited filenames remain unambiguous even when they contain spaces
  // or newlines. Disabling renames includes both sides of a moved file.
  const raw = await git.raw([
    'log',
    '--no-merges',
    '--no-renames',
    '--format=%x00%x00%H%x00',
    '--name-only',
    '-z',
    '--end-of-options',
    rev ? `${rev}..${until || 'HEAD'}` : until || 'HEAD',
    '--',
    '.',
  ]);
  const sections = raw.split(/\0\0([a-f0-9]{40})\0\0\n/g);
  if (sections[0] !== '' || sections.length !== commits.length * 2 + 1) {
    throw new Error('Could not parse the changelog commit paths');
  }
  const pathsByHash = new Map<string, string[]>();
  for (const index of commits.keys()) {
    const sectionIndex = index * 2 + 1;
    const hash = sections[sectionIndex];
    const names = sections[sectionIndex + 1];
    if (hash === undefined || names === undefined || !names.endsWith('\0')) {
      throw new Error('Could not parse the changelog commit paths');
    }
    pathsByHash.set(hash, names.slice(0, -1).split('\0'));
  }

  return changes.filter(commit => {
    const files = pathsByHash.get(commit.hash);
    if (!files) {
      throw new Error(`Missing changelog paths for commit ${commit.hash}`);
    }
    return files.some(file => {
      if (includePaths.some(directory => contains(directory, file))) {
        return true;
      }
      const owner = orderedOwners.find(directory => contains(directory, file));
      return owner === undefined || owner === workspace;
    });
  });
}

export function stripRemoteName(
  branch: string | undefined,
  remoteName: string,
): string {
  const branchName = branch || '';
  const remotePrefix = `${remoteName}/`;
  if (branchName.startsWith(remotePrefix)) {
    return branchName.slice(remotePrefix.length);
  }
  return branchName;
}

export async function getGitClient(): Promise<SimpleGit> {
  const configFileDir = getConfigFileDir() || '.';
  // Move to the directory where the config file is located
  process.chdir(configFileDir);
  logger.debug('Working directory:', process.cwd());

  // eslint-disable-next-line no-restricted-syntax -- This is the git wrapper module
  const git = simpleGit(configFileDir);
  const isRepo = await git.checkIsRepo();
  if (!isRepo) {
    throw new ConfigurationError('Not in a git repository!');
  }
  // Wrap with dry-run-aware proxy
  return createDryRunGit(git);
}

/**
 * Creates a dry-run-aware git client for a specific directory.
 *
 * Use this when you need a git client for a directory other than the
 * config file directory (e.g., for cloned repos in temp directories).
 *
 * @param directory The directory to use as the git working directory
 * @returns A SimpleGit instance wrapped with dry-run support
 */
export function createGitClient(directory: string): SimpleGit {
  // eslint-disable-next-line no-restricted-syntax -- This is the git wrapper module
  return createDryRunGit(simpleGit(directory));
}

/**
 * Clones a git repository to a target directory.
 *
 * This is a convenience wrapper that handles the common pattern of cloning
 * a repo and then creating a git client for the cloned directory.
 *
 * @param url The repository URL to clone from
 * @param targetDirectory The directory to clone into
 * @param options Optional clone options (e.g., ['--filter=tree:0'])
 * @returns A SimpleGit instance for the cloned repository
 */
export async function cloneRepo(
  url: string,
  targetDirectory: string,
  options?: string[],
): Promise<SimpleGit> {
  // eslint-disable-next-line no-restricted-syntax -- This is the git wrapper module
  const git = simpleGit();
  if (options) {
    await git.clone(url, targetDirectory, options);
  } else {
    await git.clone(url, targetDirectory);
  }
  return createGitClient(targetDirectory);
}

/**
 * Checks if the git repository has uncommitted changes
 *
 * @param repoStatus Result of git.status()
 * @returns true if the repository has uncommitted changes
 */
export function isRepoDirty(repoStatus: StatusResult): boolean {
  return !!(
    repoStatus.conflicted.length ||
    repoStatus.created.length ||
    repoStatus.deleted.length ||
    repoStatus.modified.length ||
    repoStatus.renamed.length ||
    repoStatus.staged.length
  );
}

export interface ReleaseBranchSearchResult {
  /** Branches that exactly match the configured prefix */
  exactMatches: string[];
  /** Branches with a similar prefix (Levenshtein distance ≤ 3), excluding exact matches */
  fuzzyMatches: string[];
}

/**
 * Parses the output of `git branch -r` into an array of trimmed branch names,
 * filtering out HEAD pointer entries.
 */
function parseGitBranchOutput(output: string): string[] {
  return output
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.includes('->'));
}

/**
 * Searches remote branches for those matching or similar to a given prefix.
 *
 * Fetches from remote first to get up-to-date refs, then:
 * - `exactMatches`: branches whose prefix segment matches exactly
 * - `fuzzyMatches`: branches whose prefix is within edit distance 3
 *   (catches typos like "relaese" → "release", "releases" → "release")
 *
 * @param git SimpleGit instance
 * @param prefix The release branch prefix to search for
 * @param limit Maximum number of branches to return per category
 * @returns Object with exactMatches and fuzzyMatches arrays
 */
export async function findReleaseBranches(
  git: SimpleGit,
  prefix: string,
  limit: number = 10,
): Promise<ReleaseBranchSearchResult> {
  const MAX_EDIT_DISTANCE = 3;

  try {
    await git.fetch();
  } catch {
    logger.debug('Failed to fetch from remote, using locally cached refs');
  }

  let allBranches: string[];
  try {
    const output = await git.raw('branch', '-r');
    allBranches = parseGitBranchOutput(output);
  } catch {
    logger.debug('Failed to list remote branches');
    return { exactMatches: [], fuzzyMatches: [] };
  }

  const exactMatches: string[] = [];
  const fuzzyMatches: string[] = [];

  for (const branch of allBranches) {
    // "origin/release/1.2.3" → strip remote → "release/1.2.3"
    const withoutRemote = branch.replace(/^[^/]+\//, '');

    // A release branch is "<prefix>/<version>". Treat the prefix as an opaque
    // string (slashes carry no special meaning) and recover the branch's own
    // prefix by cutting at the LAST "/": everything before it is the prefix,
    // everything after is the version. This handles slashed prefixes
    // (e.g. "release/cli" → "release/cli/1.2.3") without segment arithmetic.
    const lastSlash = withoutRemote.lastIndexOf('/');
    if (lastSlash <= 0) {
      // No version part after a prefix (or nothing before the slash): skip.
      continue;
    }
    const branchPrefix = withoutRemote.slice(0, lastSlash);

    if (branchPrefix === prefix) {
      exactMatches.push(branch);
    } else if (levenshtein(branchPrefix, prefix) <= MAX_EDIT_DISTANCE) {
      fuzzyMatches.push(branch);
    }
  }

  // git branch -r lists alphabetically; for semver branches, taking from the end gives roughly the highest versions
  return {
    exactMatches: exactMatches.slice(-limit).reverse(),
    fuzzyMatches: fuzzyMatches.slice(-limit).reverse(),
  };
}
