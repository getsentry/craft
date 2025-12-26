import simpleGit, { type SimpleGit, type LogOptions, type Options } from 'simple-git';

import { getConfigFileDir } from '../config';
import { ConfigurationError } from './errors';
import { logger } from '../logger';

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
  remoteName: string
): Promise<string> {
  // This part is courtesy of https://stackoverflow.com/a/62397081/90297
  return stripRemoteName(
    await git
      .remote(['set-head', remoteName, '--auto'])
      .revparse(['--abbrev-ref', `${remoteName}/HEAD`]),
    remoteName
  );
}

export async function getLatestTag(git: SimpleGit): Promise<string> {
  try {
    // This part is courtesy of https://stackoverflow.com/a/7261049/90297
    return (await git.raw('describe', '--tags', '--abbrev=0')).trim();
  } catch (err) {
    // If there are no tags, return an empty string
    if (
      err instanceof Error &&
      (
        err.message.startsWith('fatal: No names found') ||
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
  until?: string
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

  if (rev) {
    gitLogArgs.from = rev;
  }
  const { all: commits } = await git.log(gitLogArgs);
  return commits.map(commit => ({
    hash: commit.hash,
    title: commit.message,
    body: commit.body,
    pr: commit.message.match(PRExtractor)?.[0] || null,
  }));
}

export function stripRemoteName(
  branch: string | undefined,
  remoteName: string
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
  logger.debug("Working directory:", process.cwd());

  const git = simpleGit(configFileDir);
  const isRepo = await git.checkIsRepo();
  if (!isRepo) {
    throw new ConfigurationError('Not in a git repository!');
  }
  return git;
}
