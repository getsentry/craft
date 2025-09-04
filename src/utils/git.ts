import simpleGit, { SimpleGit } from 'simple-git';

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
  // This part is courtesy of https://stackoverflow.com/a/7261049/90297
  try {
    return (await git.raw('describe', '--tags', '--abbrev=0')).trim();
  } catch (e) {
    logger.error(
      "Couldn't get the latest tag! If you're releasing for the first time, check if your repo contains any tags. If not, add one manually and try again."
    );
    // handle this error in the global error handler
    throw e;
  }
}

export async function getChangesSince(
  git: SimpleGit,
  rev: string
): Promise<GitChange[]> {
  const { all: commits } = await git.log({
    from: rev,
    to: 'HEAD',
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
  });
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
  const remotePrefix = remoteName + '/';
  if (branchName.startsWith(remotePrefix)) {
    return branchName.slice(remotePrefix.length);
  }
  return branchName;
}

export async function getGitClient(): Promise<SimpleGit> {
  const configFileDir = getConfigFileDir() || '.';
  // Move to the directory where the config file is located
  process.chdir(configFileDir);
  logger.debug(`Working directory:`, process.cwd());

  const git = simpleGit(configFileDir);
  const isRepo = await git.checkIsRepo();
  if (!isRepo) {
    throw new ConfigurationError('Not in a git repository!');
  }
  return git;
}
