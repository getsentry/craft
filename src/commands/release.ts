import { isDryRun, shouldPerform } from 'dryrun';
import { join } from 'path';
// tslint:disable-next-line:no-submodule-imports
import * as simpleGit from 'simple-git/promise';
import { Arguments, Argv } from 'yargs';

import { getConfiguration } from '../config';
import logger from '../logger';
import { reportError } from '../utils/errors';
import { getDefaultBranch, getGithubClient } from '../utils/github_api';
import { spawnProcess } from '../utils/system';
import { isValidVersion } from '../utils/version';

export const command = ['release <major|minor|patch|new-version>', 'r'];
export const description = '🚢 Prepare a new release branch';

/** Default path to bump-version script, relative to project root */
const DEFAULT_BUMP_VERSION_PATH = join('scripts', 'bump-version.sh');

export const builder = (yargs: Argv) =>
  yargs
    .positional('part', {
      alias: 'new-version',
      description:
        'The version part (major, minor, patch) to increase, or the version itself',
      type: 'string',
    })
    .option('skip-push', {
      default: false,
      description: 'Do not push the release branch',
      type: 'boolean',
    })
    .check(checkVersionOrPart);

/** Command line options. */
interface ReleaseOptions {
  newVersion: string;
  skipPush: boolean;
}

/**
 * Checks the provided version argument for validity
 *
 * We check that the argument is either a valid version string, or a valid
 * semantic version part.
 *
 * @param argv Parsed yargs arguments
 * @param _opt A list of options and aliases
 */
function checkVersionOrPart(argv: Arguments, _opt: any): any {
  const version = argv.newVersion;
  if (['major', 'minor', 'patch'].indexOf(version) > -1) {
    throw Error('Version part is not supported yet');
  } else if (isValidVersion(version)) {
    return true;
  } else {
    throw Error(`Invalid version or version part specified: "${version}"`);
  }
}

/**
 * Creates a new local release branch
 *
 * Throws an error if the branch already exists.
 *
 * @param git Local git client
 * @param newVersion Version we are releasing
 */
async function createReleaseBranch(
  git: simpleGit.SimpleGit,
  newVersion: string
): Promise<string> {
  const branchName = `release/${newVersion}`;

  let branchHead;
  try {
    branchHead = await git.revparse([branchName]);
  } catch (e) {
    if (!e.message.match(/unknown revision/)) {
      throw e;
    }
    branchHead = '';
  }
  if (branchHead) {
    reportError(`Branch already exists: ${branchName}`, logger);
  }

  if (shouldPerform()) {
    await git.checkoutLocalBranch(branchName);
    logger.info(`Created a new release branch: ${branchName}`);
  } else {
    logger.info('[dry-run] Not creating a new release branch');
  }
  return branchName;
}

/**
 * Pushes the release branch to the remote
 *
 * @param git Local git client
 * @param defaultBranch Default branch of the remote repository
 * @param pushFlag If "true", push the release branch
 */
async function pushReleaseBranch(
  git: simpleGit.SimpleGit,
  branchName: string,
  pushFlag: boolean = true
): Promise<any> {
  if (pushFlag) {
    logger.info(`Pushing the release branch "${branchName}"...`);
    // TODO check remote somehow
    if (shouldPerform()) {
      await git.push('origin', branchName, { '--set-upstream': true });
    } else {
      logger.info('[dry-run] Not pushing the release branch.');
    }
  } else {
    logger.info('Not pushing the release branch.');
    logger.info(
      'You can push this branch later using the following command:',
      `  $ git push -u origin "${branchName}"`
    );
  }
}

/**
 * Makes a release commit of all uncommitted changes
 *
 * @param git Local git client
 * @param newVersion The version we are releasing
 */
async function commitNewVersion(
  git: simpleGit.SimpleGit,
  newVersion: string
): Promise<any> {
  const message = `release: ${newVersion}`;
  logger.info('Committing the release changes...');
  logger.debug(`Commit message: "${message}"`);
  if (shouldPerform()) {
    await git.commit(message, undefined, { '--all': true });
  } else {
    logger.info('[dry-run] Not committing the changes.');
  }
}

/**
 * Checks that it is safe to perform the release right now
 *
 * @param git Local git client
 * @param defaultBranch Default branch of the remote repository
 */
async function checkGitState(
  git: simpleGit.SimpleGit,
  defaultBranch: string
): Promise<any> {
  logger.info('Checking the local repository status...');
  const isRepo = await git.checkIsRepo();
  if (!isRepo) {
    throw new Error('Not a git repository!');
  }
  const repoStatus = await git.status();
  logger.debug('Repository status:', JSON.stringify(repoStatus));

  // Check that we are on master
  // TODO check what's here when we are in a detached state
  const currentBranch = repoStatus.current;
  if (defaultBranch !== currentBranch) {
    reportError(
      `Please switch to your default branch (${defaultBranch}) first`
    );
  }
  if (
    repoStatus.conflicted.length ||
    repoStatus.created.length ||
    repoStatus.deleted.length ||
    repoStatus.modified.length ||
    repoStatus.renamed.length ||
    repoStatus.staged.length
  ) {
    reportError(
      'Your repository is in a dirty state. ' +
        'Please stash or commit the pending changes.',
      logger
    );
  }

  if (repoStatus.ahead > 0) {
    reportError(
      `Your repository has unpushed changes: the current branch is ${
        repoStatus.ahead
      } commits ahead.`,
      logger
    );
  }
}

export const handler = async (argv: ReleaseOptions) => {
  logger.debug('Argv: ', JSON.stringify(argv));
  if (isDryRun()) {
    logger.info('[dry-run] Dry-run mode is on!');
  }

  try {
    // Get repo configuration
    const config = getConfiguration() || {};
    const githubConfig = config.github;
    const githubClient = getGithubClient();

    const defaultBranch = await getDefaultBranch(
      githubClient,
      githubConfig.owner,
      githubConfig.repo
    );
    logger.debug(`Default branch for the repo:`, defaultBranch);

    const workingDir = process.cwd();
    logger.debug(`Working directory:`, workingDir);
    const git = simpleGit(workingDir).silent(true);

    // Check that we're in an acceptable state for preparing he release
    await checkGitState(git, defaultBranch);

    const newVersion = argv.newVersion;
    logger.info(`Preparing to release the version: ${newVersion}`);

    // Create a new release branch. Throw an error if it already exists
    const branchName = await createReleaseBranch(git, newVersion);

    // Run bump version script
    // TODO check that the script exists
    logger.info(
      `Running a version-bumping script (${DEFAULT_BUMP_VERSION_PATH})...`
    );
    await spawnProcess('bash', [DEFAULT_BUMP_VERSION_PATH, '', newVersion]);

    await commitNewVersion(git, newVersion);

    // Push the release branch
    await pushReleaseBranch(git, branchName, !argv.skipPush);

    logger.success(
      'Done. Do not forget to run "craft publish" to publish the artifacts:',
      `  $ craft publish --new-version ${newVersion}`
    );
  } catch (e) {
    logger.error(e);
  }
};
