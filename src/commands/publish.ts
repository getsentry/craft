import { Arguments, Argv, CommandBuilder } from 'yargs';
import chalk from 'chalk';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  promises as fsPromises,
} from 'fs';
import { join } from 'path';
import shellQuote from 'shell-quote';
import stringLength from 'string-length';

import {
  getConfiguration,
  getStatusProviderFromConfig,
  getArtifactProviderFromConfig,
  DEFAULT_RELEASE_BRANCH_NAME,
  getGlobalGitHubConfig,
  expandWorkspaceTargets,
} from '../config';
import { formatTable, logger } from '../logger';
import { TargetConfig } from '../schemas/project_config';
import { getAllTargetNames, getTargetByName, SpecialTarget } from '../targets';
import { BaseTarget } from '../targets/base';
import { handleGlobalError, reportError } from '../utils/errors';
import { withTempDir } from '../utils/files';
import { stringToRegexp } from '../utils/filters';
import { isDryRun, promptConfirmation } from '../utils/helpers';
import { formatSize } from '../utils/strings';
import {
  catchKeyboardInterrupt,
  hasExecutable,
  spawnProcess,
} from '../utils/system';
import { isValidVersion } from '../utils/version';
import { BaseStatusProvider } from '../status_providers/base';
import { BaseArtifactProvider } from '../artifact_providers/base';
import { SimpleGit } from 'simple-git';
import { getGitClient, getDefaultBranch } from '../utils/git';

/** Default path to post-release script, relative to project root */
const DEFAULT_POST_RELEASE_SCRIPT_PATH = join('scripts', 'post-release.sh');

/**
 * Environment variables to pass through to the post-release command.
 * HOME is needed so Git can find ~/.gitconfig with safe.directory settings,
 * which fixes "fatal: detected dubious ownership in repository" errors.
 * The git identity vars help with commit operations in post-release scripts.
 */
const ALLOWED_ENV_VARS = [
  'HOME',
  'USER',
  'GIT_COMMITTER_NAME',
  'GIT_AUTHOR_NAME',
  'EMAIL',
] as const;

export const command = ['publish NEW-VERSION'];
export const aliases = ['pp', 'publish'];
export const description = '🛫 Publish artifacts';

export const builder: CommandBuilder = (yargs: Argv) => {
  const definedTargets = getConfiguration().targets || [];
  const possibleTargetNames = new Set(getAllTargetNames());
  const allowedTargetNames = definedTargets
    .filter(target => target.name && possibleTargetNames.has(target.name))
    .map(BaseTarget.getId);

  return yargs
    .positional('NEW-VERSION', {
      description: 'Version to publish',
      type: 'string',
    })
    .option('target', {
      alias: 't',
      choices: allowedTargetNames.concat([
        SpecialTarget.All,
        SpecialTarget.None,
      ]),
      default: SpecialTarget.All,
      description: 'Publish to this target',
      type: 'string',
    })
    .option('rev', {
      alias: 'r',
      description:
        'Source revision (git SHA or tag) to publish (if not release branch head)',
      type: 'string',
    })
    .option('merge-target', {
      alias: 'm',
      description:
        'Target branch to merge into. Uses the default branch from GitHub as a fallback',
      type: 'string',
    })
    .option('remote', {
      default: 'origin',
      description: 'The git remote to use when pushing',
      type: 'string',
    })
    .option('no-merge', {
      default: false,
      description: 'Do not merge the release branch after publishing',
      type: 'boolean',
    })
    .option('keep-branch', {
      default: false,
      description: 'Do not remove release branch after merging it',
      type: 'boolean',
    })
    .option('keep-downloads', {
      default: false,
      description: 'Keep all downloaded files',
      type: 'boolean',
    })
    .option('no-status-check', {
      default: false,
      description: 'Do not check for build status',
      type: 'boolean',
    })
    .check(checkVersion)
    .demandOption('new-version', 'Please specify the version to publish');
};

/** Command line options. */
export interface PublishOptions {
  /** The git remote to use when pushing */
  remote: string;
  /** Revision to publish (can be commit, tag, etc.) */
  rev?: string;
  /** Target branch to merge the release into, auto detected when empty */
  mergeTarget?: string;
  /** One or more targets we want to publish */
  target?: string | string[];
  /** The new version to publish */
  newVersion: string;
  /** Do not perform merge after publishing */
  noMerge: boolean;
  /** Do not remove downloads after publishing */
  keepDownloads: boolean;
  /** Do not perform build status check */
  noStatusCheck: boolean;
  /** Do not remove release branch after publishing */
  keepBranch: boolean;
}

export interface PublishState {
  published: {
    [targetId: string]: boolean;
  };
}

/**
 * Checks that the passed version is a valid version string
 *
 * @param argv Parsed yargs arguments
 * @param _opt A list of options and aliases
 */
function checkVersion(argv: Arguments<any>, _opt: any): any {
  const version = argv.newVersion;
  if (isValidVersion(version)) {
    return true;
  } else {
    throw Error(`Invalid version provided: "${version}"`);
  }
}

/**
 * Publishes artifacts to the provided target
 *
 * @param target The target instance to publish
 * @param version New version to be released
 * @param revision Git commit SHA of the commit to be published
 */
async function publishToTarget(
  target: BaseTarget,
  version: string,
  revision: string
): Promise<void> {
  const publishMessage = `=== Publishing to target: ${chalk.bold.cyan(
    target.id
  )} ===`;
  const delim = Array(stringLength(publishMessage) + 1).join('=');
  logger.info(' ');
  logger.info(delim);
  logger.info(publishMessage);
  logger.info(delim);
  await target.publish(version, revision);
}

/**
 * Prints summary for the revision, including available artifacts
 *
 * @param artifactProvider Artifact provider instance
 * @param revision Git revision SHA
 */
async function printRevisionSummary(
  artifactProvider: BaseArtifactProvider,
  revision: string
): Promise<void> {
  const artifacts = await artifactProvider.listArtifactsForRevision(revision);
  if (artifacts.length > 0) {
    const artifactData = artifacts.map(ar => [
      ar.filename,
      formatSize(ar.storedFile.size),
      ar.storedFile.lastUpdated || '',

      // sometimes mimeTypes are stored with the encoding included, e.g.
      // `application/javascript; charset=utf-8`, but we only really care about
      // the first part
      (ar.mimeType && ar.mimeType.split(';')[0]) || '',
    ]);
    // sort alphabetically by filename
    artifactData.sort((a1, a2) => (a1[0] < a2[0] ? -1 : a1[0] > a2[0] ? 1 : 0));
    const table = formatTable(
      {
        head: ['File Name', 'Size', 'Updated', 'ContentType'],
        style: { head: ['cyan'] },
      },
      artifactData
    );
    logger.info(' ');
    logger.info(`Available artifacts: \n${table.toString()}\n`);
  } else {
    logger.warn('No artifacts found for the revision.');
  }
}

async function getTargetList(
  targetConfigList: TargetConfig[],
  artifactProvider: BaseArtifactProvider
): Promise<BaseTarget[]> {
  logger.trace('Initializing targets');
  const githubRepo = await getGlobalGitHubConfig();
  const targetList: BaseTarget[] = [];
  for (const targetConfig of targetConfigList) {
    const targetClass = getTargetByName(targetConfig.name);
    const targetDescriptor = BaseTarget.getId(targetConfig);
    if (!targetClass) {
      logger.warn(`Target implementation for "${targetDescriptor}" not found.`);
      continue;
    }
    try {
      logger.debug(`Creating target ${targetDescriptor}`);
      logger.trace(targetConfig);
      const target = new targetClass(
        targetConfig,
        artifactProvider,
        githubRepo
      );
      targetList.push(target);
    } catch (err) {
      logger.error(`Error creating target instance for ${targetDescriptor}!`);
      throw err;
    }
  }

  return targetList;
}

/**
 * Check that for every provided pattern there's an artifact for the revision
 *
 * This helps to catch cases when there are several independent providers (e.g. Travis,
 * Appveyor), and there's no clear indication when ALL of those providers have
 * finished their builds.
 * Using the "requiredNames", we can introduce artifact patterns/names that *have* to
 * be present before starting the publishing process.
 *
 * @param artifactProvider Artifact provider instance
 * @param revision Git revision SHA
 * @param requiredNames A list of patterns that all have to match
 */
async function checkRequiredArtifacts(
  artifactProvider: BaseArtifactProvider,
  revision: string,
  requiredNames?: string[]
): Promise<void> {
  if (!requiredNames || requiredNames.length === 0) {
    return;
  }
  logger.debug('Checking that the required artifact names are present...');
  const artifacts = await artifactProvider.listArtifactsForRevision(revision);

  // innocent until proven guilty...
  let checkPassed = true;

  for (const requiredNameRegexString of requiredNames) {
    const requiredNameRegex = stringToRegexp(requiredNameRegexString);
    const matchedArtifacts = artifacts.filter(artifact =>
      requiredNameRegex.test(artifact.filename)
    );
    if (matchedArtifacts.length === 0) {
      checkPassed = false;
      reportError(
        `No matching artifact found for the required pattern: ${requiredNameRegexString}`
      );
    } else {
      logger.debug(
        `Artifact "${matchedArtifacts[0].filename}" matches pattern ${requiredNameRegexString}`
      );
    }
  }

  // only in dry-run mode might we fail the overall test but still get here
  if (checkPassed) {
    logger.debug('Check for "requiredNames" passed.');
  } else {
    logger.error('Check for "requiredNames" failed.');
  }
}

/**
 * Checks statuses of all builds on the status provider for the provided revision
 *
 * @param statusProvider Status provider instance
 * @param revision Git commit SHA to check
 * @param skipStatusCheckFlag A flag to enable/disable this check
 */
async function checkRevisionStatus(
  statusProvider: BaseStatusProvider,
  revision: string,
  skipStatusCheckFlag = false
): Promise<void> {
  if (skipStatusCheckFlag) {
    logger.warn(`Skipping build status checks for revision ${revision}`);
    return;
  }

  try {
    logger.debug('Fetching repository information...');
    // This will additionally check that the user has proper permissions
    const repositoryInfo = await statusProvider.getRepositoryInfo();
    logger.debug('Repository info received');
    logger.trace(repositoryInfo);
  } catch (e) {
    logger.error(
      `Cannot get repository information from ${statusProvider.config.name}. Check your configuration and credentials.`
    );
    reportError(e);
  }

  await statusProvider.waitForTheBuildToSucceed(revision);
}

/**
 * Deals with the release branch after publishing is done
 *
 * Leave the release branch unmerged, or merge it but not delete it if the
 * corresponding flags are set.
 *
 * @param git Git client
 * @param remoteName The git remote name to interact with
 * @param branch Name of the release branch
 * @param [mergeTarget] Branch name to merge the release branch into
 * @param keepBranch If set to "true", the branch will not be deleted
 */
async function handleReleaseBranch(
  git: SimpleGit,
  remoteName: string,
  branch: string,
  mergeTarget?: string,
  keepBranch = false
): Promise<void> {
  if (!mergeTarget) {
    mergeTarget = await getDefaultBranch(git, remoteName);
  }
  logger.debug(`Checking out merge target branch:`, mergeTarget);
  await git.checkout(mergeTarget);

  logger.debug(`Merging ${branch} into: ${mergeTarget}`);
  if (!isDryRun()) {
    await git
      .pull(remoteName, mergeTarget, ['--rebase'])
      .merge(['--no-ff', '--no-edit', branch])
      .push(remoteName, mergeTarget);
  } else {
    logger.info('[dry-run] Not merging the release branch');
  }

  if (keepBranch) {
    logger.info('Not deleting the release branch.');
  } else {
    logger.debug(`Deleting the release branch: ${branch}`);
    if (!isDryRun()) {
      await git.branch(['-D', branch]).push([remoteName, '--delete', branch]);
      logger.info(`Removed the remote branch: "${branch}"`);
    } else {
      logger.info('[dry-run] Not deleting the remote branch');
    }
  }
}

/**
 * Run an external post-release command
 *
 * The command is usually for bumping the development version on master or
 * cleanup tasks.
 *
 * @param newVersion Version being released
 * @param postReleaseCommand Custom post-release command
 */
export async function runPostReleaseCommand(
  newVersion: string,
  postReleaseCommand?: string
): Promise<boolean> {
  let sysCommand: shellQuote.ParseEntry;
  let args: shellQuote.ParseEntry[];
  if (postReleaseCommand !== undefined && postReleaseCommand.length === 0) {
    // Not running post-release command
    logger.debug('Not running the post-release command: no command specified');
    return false;
  } else if (postReleaseCommand) {
    [sysCommand, ...args] = shellQuote.parse(postReleaseCommand);
  } else if (hasExecutable(DEFAULT_POST_RELEASE_SCRIPT_PATH)) {
    sysCommand = '/bin/bash';
    args = [DEFAULT_POST_RELEASE_SCRIPT_PATH];
  } else {
    // Not running post-release command
    logger.info(
      `Not running the optional post-release command: '${DEFAULT_POST_RELEASE_SCRIPT_PATH}' not found`
    );
    return false;
  }
  args = [...args, '', newVersion];
  logger.info(`Running the post-release command...`);
  await spawnProcess(sysCommand as string, args as string[], {
    env: {
      CRAFT_NEW_VERSION: newVersion,
      CRAFT_OLD_VERSION: '',
      PATH: process.env.PATH,
      GITHUB_TOKEN: process.env.GITHUB_TOKEN,
      ...Object.fromEntries(
        ALLOWED_ENV_VARS.map(key => [key, process.env[key]])
      ),
    },
  });
  return true;
}

/**
 * Body of 'publish' command
 *
 * @param argv Command-line arguments
 */
export async function publishMain(argv: PublishOptions): Promise<any> {
  // Get publishing configuration
  const config = getConfiguration() || {};

  const newVersion = argv.newVersion;

  logger.info(`Publishing version: "${newVersion}"`);

  const git = await getGitClient();

  const rev = argv.rev;
  let checkoutTarget;
  let branchName;
  if (rev) {
    logger.debug(`Trying to get branch name for provided revision: "${rev}"`);
    branchName = (
      await git.raw('name-rev', '--name-only', '--no-undefined', rev)
    ).trim();
    checkoutTarget = branchName || rev;
  } else {
    // Find the remote branch
    const branchPrefix =
      config.releaseBranchPrefix || DEFAULT_RELEASE_BRANCH_NAME;
    branchName = `${branchPrefix}/${newVersion}`;
    checkoutTarget = branchName;
  }

  logger.debug('Checking out release branch', branchName);
  await git.checkout(checkoutTarget);

  const revision = await git.revparse('HEAD');
  logger.debug('Revision to publish: ', revision);

  const statusProvider = await getStatusProviderFromConfig();
  const artifactProvider = await getArtifactProviderFromConfig();

  // Check status of all CI builds linked to the revision
  await checkRevisionStatus(statusProvider, revision, argv.noStatusCheck);

  await printRevisionSummary(artifactProvider, revision);
  await checkRequiredArtifacts(artifactProvider, revision, config.requireNames);

  // Find targets
  let targetsToPublish: Set<string> = new Set(
    (typeof argv.target === 'string' ? [argv.target] : argv.target) || [
      SpecialTarget.All,
    ]
  );

  // Treat "all"/"none" specially
  for (const specialTarget of [SpecialTarget.All, SpecialTarget.None]) {
    if (targetsToPublish.size > 1 && targetsToPublish.has(specialTarget)) {
      logger.error(
        `Target "${specialTarget}" specified together with other targets. Exiting.`
      );
      return undefined;
    }
  }

  // Expand any npm workspace targets into individual package targets
  let targetConfigList = await expandWorkspaceTargets(config.targets || []);

  logger.info(`Looking for publish state file for ${newVersion}...`);
  const publishStateFile = `.craft-publish-${newVersion}.json`;
  const earlierStateExists = existsSync(publishStateFile);
  let publishState: PublishState;
  if (earlierStateExists) {
    logger.info(`Found publish state file, resuming from there...`);
    publishState = JSON.parse(readFileSync(publishStateFile).toString());
    targetsToPublish = new Set(targetConfigList.map(BaseTarget.getId));
  } else {
    publishState = { published: Object.create(null) };
  }

  for (const published of Object.keys(publishState.published)) {
    logger.info(
      `Skipping target ${published} as it is marked as successful in state file.`
    );
    targetsToPublish.delete(published);
  }

  if (!targetsToPublish.has(SpecialTarget.All)) {
    targetConfigList = targetConfigList.filter(targetConf =>
      targetsToPublish.has(BaseTarget.getId(targetConf))
    );
  }

  if (
    !targetsToPublish.has(SpecialTarget.None) &&
    !earlierStateExists &&
    targetConfigList.length === 0
  ) {
    logger.warn('No valid targets detected! Exiting.');
    return undefined;
  }

  const targetList = await getTargetList(targetConfigList, artifactProvider);
  if (targetList.length > 0) {
    logger.info('Publishing to targets:');

    logger.info(targetList.map(target => `  - ${target.id}`).join('\n'));
    logger.info(' ');
    await promptConfirmation();

    await withTempDir(async (downloadDirectory: string) => {
      artifactProvider.setDownloadDirectory(downloadDirectory);

      // Publish to all targets
      for (const target of targetList) {
        await publishToTarget(target, newVersion, revision);
        publishState.published[BaseTarget.getId(target.config)] = true;
        if (!isDryRun()) {
          writeFileSync(publishStateFile, JSON.stringify(publishState));
        }
      }

      if (argv.keepDownloads) {
        logger.info(
          'Directory with the downloaded artifacts will not be removed',
          `Path: ${downloadDirectory}`
        );
      }
    }, !argv.keepDownloads);

    logger.info(' ');
  }

  if (argv.noMerge) {
    logger.info('Not merging per user request via no-merge option.');
  } else if (!branchName) {
    logger.info(
      'Not merging because cannot determine a branch name to merge from.'
    );
  } else if (
    targetsToPublish.has(SpecialTarget.All) ||
    targetsToPublish.has(SpecialTarget.None) ||
    earlierStateExists
  ) {
    // Publishing done, MERGE DAT BRANCH!
    await handleReleaseBranch(
      git,
      argv.remote,
      branchName,
      argv.mergeTarget,
      argv.keepBranch
    );
    if (!isDryRun()) {
      // XXX(BYK): intentionally DO NOT await unlinking as we do not want
      // to block (both in terms of waiting for IO and the success of the
      // operation) finishing the publish flow on the removal of a temporary
      // file. If unlinking fails, we honestly don't care, at least to fail
      // the final steps. And it doesn't make sense to wait until this op
      // finishes then as nothing relies on the removal of this file.
      fsPromises
        .unlink(publishStateFile)
        .catch(err =>
          logger.trace("Couldn't remove publish state file: ", err)
        );
    }
    logger.success(`Version ${newVersion} has been published!`);
  } else {
    const msg = [
      'The release branch was not merged because you published only to specific targets.',
      'After all the targets are published, run the following command to merge the release branch:',
      `  $ craft publish ${newVersion} --target none\n`,
    ];
    logger.warn(msg.join('\n'));
  }

  // Run the post-release script
  await runPostReleaseCommand(newVersion, config.postReleaseCommand);
}

export const handler = async (args: {
  [argName: string]: any;
}): Promise<any> => {
  try {
    catchKeyboardInterrupt();
    return await publishMain(args as PublishOptions);
  } catch (e) {
    handleGlobalError(e);
  }
};
