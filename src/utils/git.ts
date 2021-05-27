import simpleGit, { SimpleGit } from 'simple-git';

import { getConfigFileDir } from '../config';
import { ConfigurationError } from './errors';
import { logger } from '../logger';

export async function getDefaultBranch(
  git: SimpleGit,
  remoteName: string
): Promise<string> {
  // This part is courtesy of https://stackoverflow.com/a/62397081/90297
  return stripRemoteName(
    await git.revparse(['--abbrev-ref', `${remoteName}/HEAD`]),
    remoteName
  );
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
