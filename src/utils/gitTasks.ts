import * as simpleGit from 'simple-git/promise';
import { logger } from '../logger';
import { isDryRun } from './helpers';

/**
 * Adds the directories, commits to the remote and branch, and pushes.
 * @param git Git.
 * @param dirsToAdd Directories to be added.
 * @param commitMsg Message of the commit.
 * @param remote Git remote.
 * @param branch Git branch.
 */
export async function syncChangesToRemote(
  git: simpleGit.SimpleGit,
  dirsToAdd: string[],
  commitMsg: string,
  remote = 'origin',
  branch = 'master'
): Promise<void> {
  await git.add(dirsToAdd);
  await git.commit(commitMsg);
  // Push!
  if (!isDryRun()) {
    logger.info(`Pushing the changes...`);
    await git.push(remote, branch);
  } else {
    logger.info('[dry-run] Not pushing the branch.');
  }
}

/**
 * Performs a `git checkout` on the given directory.
 * @param directory The directory to perform the git action in.
 * @param branch The tag or revision to be checked out.
 *  Additional arguments can be provided by including an array of strings.
 */
export async function gitCheckout(
  directory: string,
  what: string | string[] = 'master'
): Promise<simpleGit.SimpleGit> {
  const git = simpleGit(directory).silent(true);
  await git.checkout(what);
  return git;
}

/**
 * Clones the repo in the directory.
 * @param repoPath The repo to be cloned.
 * @param directory The directory to be cloned the repo in.
 */
export async function gitClone(
  repoPath: string,
  directory: string
): Promise<simpleGit.SimpleGit> {
  const git = simpleGit().silent(true);
  await git.clone(repoPath, directory);
  return git;
}
