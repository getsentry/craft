import { isDryRun, shouldPerform } from 'dryrun';
import { join } from 'path';
// tslint:disable-next-line:no-submodule-imports
import * as simpleGit from 'simple-git/promise';
import { Argv } from 'yargs';

import { getConfiguration } from '../config';
import logger from '../logger';
import { getDefaultBranch, getGithubClient } from '../utils/github_api';
import { spawnProcess } from '../utils/system';
import { isValidVersion } from '../utils/version';

export const command = ['release [part]', 'r'];
export const description = '🚢 Prepare a new release';

export const builder = (yargs: Argv) =>
  yargs
    .positional('part', {
      alias: 'p',
      choices: ['major', 'minor', 'patch'],
      default: 'patch',
      description: 'The part of the version to increase',
      type: 'string',
    })
    .option('new-version', {
      description: 'The new version to release',
      type: 'string',
    })
    .option('push-release-branch', {
      default: true,
      description: 'Push the release branch',
      type: 'boolean',
    });

/** Command line options. */
interface ReleaseOptions {
  part: string;
  newVersion?: string;
  pushReleaseBranch: boolean;
}

/** Default path to bump-version script, relative to project root */
const DEFAULT_BUMP_VERSION_PATH = join('scripts', 'bump-version.sh');

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
    const errorMsg = `Branch already exists: ${branchName}`;
    if (shouldPerform()) {
      throw new Error(errorMsg);
    } else {
      logger.error(errorMsg);
    }
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
 * @param pushFlag A flag that indicates that the branch has to be pushed
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
  logger.debug('Checking the local repository status...');
  const isRepo = await git.checkIsRepo();
  if (!isRepo) {
    throw new Error('Not a git repository!');
  }
  const repoStatus = await git.status();
  // Check that we are on master
  // TODO check what's here when we are in a detached state
  const currentBranch = repoStatus.current;
  if (defaultBranch !== currentBranch) {
    throw new Error(
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
    logger.debug(JSON.stringify(repoStatus));
    const errorMsg =
      'Your repository is in a dirty state. ' +
      'Please stash or commit the pending changes.';
    if (shouldPerform()) {
      throw new Error(errorMsg);
    } else {
      logger.error(`[dry-run] ${errorMsg}`);
    }
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
    const git = simpleGit(workingDir).silent(true);
    logger.debug(`Working directory:`, workingDir);

    // Check that we're in an acceptable state for preparing he release
    await checkGitState(git, defaultBranch);

    const newVersion = argv.newVersion;
    if (!newVersion) {
      throw new Error('Not implemented: specify the new version');
    }

    if (!isValidVersion(newVersion)) {
      throw new Error(`Invalid version specified: ${newVersion}`);
    }

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
    await pushReleaseBranch(git, branchName, argv.pushReleaseBranch);

    logger.info('Done.');
  } catch (e) {
    logger.error(e);
  }
};
