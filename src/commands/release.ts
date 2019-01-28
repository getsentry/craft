import { shouldPerform } from 'dryrun';
import { existsSync, readFileSync } from 'fs';
import { dirname, join, relative } from 'path';
import * as shellQuote from 'shell-quote';
// tslint:disable-next-line:no-submodule-imports
import * as simpleGit from 'simple-git/promise';
import { Arguments, Argv } from 'yargs';

import {
  checkMinimalConfigVersion,
  getConfigFilePath,
  getConfiguration,
} from '../config';
import { logger } from '../logger';
import { ChangelogPolicy } from '../schemas/project_config';
import { DEFAULT_CHANGELOG_PATH, findChangeset } from '../utils/changes';
import { reportError } from '../utils/errors';
import { getDefaultBranch, getGithubClient } from '../utils/githubApi';
import { sleepAsync, spawnProcess } from '../utils/system';
import { isValidVersion, versionToTag } from '../utils/version';
import { publishMain, PublishOptions } from './publish';

export const command = ['release <major|minor|patch|new-version>', 'r'];
export const aliases = [
  'pre-release',
  'prerelease',
  'pre-publish',
  'prepublish',
  'prepare',
];
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
    .option('no-push', {
      default: false,
      description: 'Do not push the release branch',
      type: 'boolean',
    })
    .option('no-git-checks', {
      default: false,
      description: 'Ignore local git changes and unsynchronized remotes',
      type: 'boolean',
    })
    .option('no-changelog', {
      default: false,
      description: 'Do not check for changelog entries',
      type: 'boolean',
    })
    .option('publish', {
      default: false,
      description: 'Run "publish" right after "release"',
      type: 'boolean',
    })
    .check(checkVersionOrPart);

/** Command line options. */
interface ReleaseOptions {
  /** The new version to release */
  newVersion: string;
  /** Do not perform basic git checks */
  noGitChecks: boolean;
  /** Do not check for changelog */
  noChangelog: boolean;
  /** Do not push the newly created release branch */
  noPush: boolean;
  /** Run publish right after */
  publish: boolean;
}

/**
 * Wait for this number of seconds before publishing, if the corresponding
 * flag was specified
 */
const SLEEP_BEFORE_PUBLISH_SECONDS = 30;

/**
 * Checks the provided version argument for validity
 *
 * We check that the argument is either a valid version string, or a valid
 * semantic version part.
 *
 * @param argv Parsed yargs arguments
 * @param _opt A list of options and aliases
 */
function checkVersionOrPart(argv: Arguments<any>, _opt: any): any {
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
    let errorMsg = `Branch already exists: ${branchName}. `;
    errorMsg +=
      'Run the following commands to delete the branch, and then rerun "release":\n';
    errorMsg += `    git branch -D ${branchName}; git push origin --delete ${branchName}\n`;
    reportError(errorMsg, logger);
  }

  if (shouldPerform()) {
    await git.checkoutLocalBranch(branchName);
    logger.info(`Created a new release branch: "${branchName}"`);
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
  const repoStatus = await git.status();
  if (!(repoStatus.created.length || repoStatus.modified.length)) {
    reportError('Nothing to commit: has the pre-release command done its job?');
  }

  logger.info('Committing the release changes...');
  logger.debug(`Commit message: "${message}"`);
  if (shouldPerform()) {
    await git.commit(message, undefined, { '--all': true });
  } else {
    logger.info('[dry-run] Not committing the changes.');
  }
}

/**
 * Run an external pre-release command
 *
 * The command usually executes operations for version bumping and might
 * include dependency updates.
 *
 * @param newVersion Version being released
 * @param preReleaseCommand Custom pre-release command
 */
export async function runPreReleaseCommand(
  newVersion: string,
  preReleaseCommand?: string
): Promise<void> {
  let sysCommand: string;
  let args: string[];
  if (preReleaseCommand === '') {
    // Not running pre-release command
    logger.warn('Not running the pre-release command: no command specified');
    return;
  } else if (preReleaseCommand) {
    [sysCommand, ...args] = shellQuote.parse(preReleaseCommand);
  } else {
    sysCommand = '/bin/bash';
    args = [DEFAULT_BUMP_VERSION_PATH];
  }
  args = [...args, '', newVersion];
  logger.info(`Running the pre-release command...`);
  const additionalEnv = {
    CRAFT_NEW_VERSION: newVersion,
    CRAFT_OLD_VERSION: '',
  };
  await spawnProcess(sysCommand, args, {
    env: { ...process.env, ...additionalEnv },
  });
}

/**
 * Checks that it is safe to perform the release right now
 *
 * @param git Local git client
 * @param defaultBranch Default branch of the remote repository
 * @param checkGitStatus Set to true to enable the check
 */
async function checkGitState(
  git: simpleGit.SimpleGit,
  defaultBranch: string,
  checkGitStatus: boolean = true
): Promise<void> {
  if (!checkGitStatus) {
    logger.warn('Not checking the status of the local repository');
    return;
  }

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

/**
 * Run the "publish" step and terminate the process.
 *
 * This function will never return: it terminates the process with the
 * corresponding error code after publishing is done.
 *
 * @param newVersion Version to publish
 */
async function execPublish(newVersion: string): Promise<never> {
  logger.info('Running the "publish" command...');
  const publishOptions: PublishOptions = {
    keepBranch: false,
    keepDownloads: false,
    newVersion,
    noMerge: false,
    noStatusCheck: false,
  };
  logger.info(
    `Sleeping for ${SLEEP_BEFORE_PUBLISH_SECONDS} seconds before publishing...`
  );
  if (shouldPerform()) {
    await sleepAsync(SLEEP_BEFORE_PUBLISH_SECONDS * 1000);
  } else {
    logger.info('[dry-run] Not wasting time on sleep');
  }

  try {
    await publishMain(publishOptions);
    process.exit(0);
  } catch (e) {
    logger.error(e);
    logger.error(
      'There was an error running "publish". Fix the issue and run the command manually:',
      `  $ craft publish ${newVersion}`
    );
    process.exit(1);
  }
  throw new Error('Unreachable');
}

/**
 * Checks that there is no corresponding git tag for the given version
 *
 * @param git Local git client
 * @param newVersion Version we're about to release
 * @param checkGitStatus Set to true to enable the check
 */
async function checkForExistingTag(
  git: simpleGit.SimpleGit,
  newVersion: string,
  checkGitStatus: boolean = true
): Promise<void> {
  if (!checkGitStatus) {
    logger.warn('Not checking if the version (git tag) already exists');
  }

  const gitTag = versionToTag(newVersion);
  const existingTags = await git.tags();
  if (existingTags.all.indexOf(gitTag) > -1) {
    reportError(`Git tag "${gitTag}" already exists!`);
  }
  logger.debug(`Git tag ${gitTag} does not exist yet.`);
}

/**
 * Checks changelog entries in accordance with the provided changelog policy.
 *
 * @param newVersion The new version we are releasing
 * @param changelogPolicy One of the changelog policies, such as "none", "simple", etc.
 * @param changelogPath Path to the changelog file
 */
async function checkChangelog(
  newVersion: string,
  changelogPolicy: ChangelogPolicy = ChangelogPolicy.None,
  changelogPath: string = DEFAULT_CHANGELOG_PATH
): Promise<void> {
  if (changelogPolicy === ChangelogPolicy.None) {
    logger.info(
      `Changelog policy is set to "${changelogPolicy}", nothing to do.`
    );
    return;
  } else if (changelogPolicy === ChangelogPolicy.Simple) {
    logger.info('Checking the changelog...');
    logger.debug(`Changelog policy: "${changelogPolicy}".`);
    const relativePath = relative('', changelogPath);
    if (relativePath.startsWith('.')) {
      throw new Error(`Invalid changelog path: "${changelogPath}"`);
    }
    if (!existsSync(relativePath)) {
      throw new Error(`Changelog does not exist: "${changelogPath}"`);
    }
    const changelogString = readFileSync(relativePath).toString();
    logger.debug(`Changelog path: ${relativePath}`);
    const changeset = findChangeset(changelogString, newVersion);
    if (!changeset || !changeset.body) {
      throw new Error(`No changelog entry found for version "${newVersion}"`);
    }
    logger.debug(`Changelog entry found:\n"""\n${changeset.body}\n"""`);
    return;
  } else {
    throw new Error(`Invalid changelog policy: "${changelogPolicy}"`);
  }
}

/**
 * Switches to the default branch of the repo
 *
 * @param git Local git client
 * @param defaultBranch Default branch of the remote repository
 */
async function switchToDefaultBranch(
  git: simpleGit.SimpleGit,
  defaultBranch: string
): Promise<void> {
  const repoStatus = await git.status();
  if (repoStatus.current === defaultBranch) {
    return;
  }
  logger.info(`Switching back to the default branch (${defaultBranch})...`);
  if (shouldPerform()) {
    await git.checkout(defaultBranch);
  } else {
    logger.info('[dry-run] Not switching branches.');
  }
}

/**
 * Body of 'release' command
 *
 * @param argv Command-line arguments
 */
export async function releaseMain(argv: ReleaseOptions): Promise<any> {
  logger.debug('Argv: ', JSON.stringify(argv));
  checkMinimalConfigVersion();

  // Get repo configuration
  const config = getConfiguration();
  const githubConfig = config.github;

  // Move to the directory where the config file is located
  const configFileDir = dirname(getConfigFilePath());
  process.chdir(configFileDir);
  logger.debug(`Working directory:`, configFileDir);

  const newVersion = argv.newVersion;

  const git = simpleGit(configFileDir).silent(true);

  // Get some information about the Github project
  const githubClient = getGithubClient();
  const defaultBranch = await getDefaultBranch(
    githubClient,
    githubConfig.owner,
    githubConfig.repo
  );
  logger.debug(`Default branch for the repo:`, defaultBranch);

  // Check that we're in an acceptable state for the release
  await checkGitState(git, defaultBranch, !argv.noGitChecks);

  // Check whether the version/tag already exists
  await checkForExistingTag(git, newVersion, !argv.noGitChecks);

  // Check the changelog(s)
  await checkChangelog(
    newVersion,
    argv.noChangelog ? ChangelogPolicy.None : config.changelogPolicy,
    config.changelog
  );

  logger.info(`Preparing to release the version: ${newVersion}`);

  // Create a new release branch. Throw an error if it already exists
  const branchName = await createReleaseBranch(git, newVersion);

  // Run a pre-release script (e.g. for version bumping)
  await runPreReleaseCommand(newVersion, config.preReleaseCommand);

  // Commit the pending changes
  await commitNewVersion(git, newVersion);

  // Push the release branch
  await pushReleaseBranch(git, branchName, !argv.noPush);

  logger.info(
    `View diff at: https://github.com/${githubConfig.owner}/${
      githubConfig.repo
    }/compare/${branchName}`
  );

  if (argv.publish) {
    logger.success(`Release branch "${branchName}" has been pushed.`);
    await execPublish(newVersion);
  } else {
    logger.success(
      'Done. Do not forget to run "craft publish" to publish the artifacts:',
      `  $ craft publish ${newVersion}`
    );
  }

  await switchToDefaultBranch(git, defaultBranch);
}

export const handler = async (argv: ReleaseOptions) => {
  try {
    return await releaseMain(argv);
  } catch (e) {
    logger.error(e);
    process.exit(1);
  }
};
