import * as Github from '@octokit/rest';
import * as inquirer from 'inquirer';
import { Arguments, Argv, CommandBuilder } from 'yargs';
import chalk from 'chalk';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  promises as fsPromises,
} from 'fs';
import { join } from 'path';
import * as shellQuote from 'shell-quote';
import * as stringLength from 'string-length';

import {
  checkMinimalConfigVersion,
  getConfiguration,
  getStatusProviderFromConfig,
  getArtifactProviderFromConfig,
  DEFAULT_RELEASE_BRANCH_NAME,
} from '../config';
import { formatTable, logger } from '../logger';
import { GithubGlobalConfig } from '../schemas/project_config';
import {
  getAllTargetNames,
  getTargetByName,
  getTargetId,
  SpecialTarget,
} from '../targets';
import { BaseTarget } from '../targets/base';
import { coerceType, handleGlobalError, reportError } from '../utils/errors';
import { withTempDir } from '../utils/files';
import { stringToRegexp } from '../utils/filters';
import { getGithubClient, mergeReleaseBranch } from '../utils/githubApi';
import { isDryRun } from '../utils/helpers';
import { hasInput } from '../utils/noInput';
import { formatSize, formatJson } from '../utils/strings';
import {
  catchKeyboardInterrupt,
  hasExecutable,
  spawnProcess,
} from '../utils/system';
import { isValidVersion } from '../utils/version';
import { BaseStatusProvider } from '../status_providers/base';
import { BaseArtifactProvider } from '../artifact_providers/base';

/** Default path to post-release script, relative to project root */
const DEFAULT_POST_RELEASE_SCRIPT_PATH = join('scripts', 'post-release.sh');

export const command = ['publish NEW-VERSION'];
export const aliases = ['pp', 'publish'];
export const description = '🛫 Publish artifacts';

export const builder: CommandBuilder = (yargs: Argv) => {
  const definedTargets = getConfiguration().targets || [];
  const possibleTargetNames = new Set(getAllTargetNames());
  const allowedTargetNames = definedTargets
    .filter(target => target.name && possibleTargetNames.has(target.name))
    .map(getTargetId);

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
  /** Revision to publish (can be commit, tag, etc.) */
  rev?: string;
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
  const publishMessage = `=== Publishing to target: ${chalk.bold(
    chalk.cyan(getTargetId(target.config))
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

/**
 * Prompt the user that everything is OK and we should proceed with publishing
 */
async function promptConfirmation(): Promise<void> {
  if (hasInput()) {
    const questions = [
      {
        message: 'Is everything OK? Type "yes" to proceed:',
        name: 'readyToPublish',
        type: 'input',
        validate: (input: string) => input.length > 2 || 'Please type "yes"',
      },
    ];
    const answers = (await inquirer.prompt(questions)) as any;
    const readyToPublish = coerceType<string>(answers.readyToPublish, 'string');
    if (readyToPublish.toLowerCase() !== 'yes') {
      logger.error('Oh, okay. Aborting.');
      process.exit(1);
    }
  } else {
    logger.debug('Skipping the prompting.');
  }
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
 * @param zeus Zeus store object
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

// TODO there is at least one case that is not covered: how to detect Zeus builds
// that have unknown status (neither failed nor succeeded)
/**
 * Checks statuses of all builds on Zeus for the provided revision
 *
 * @param zeus Zeus store object
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
    logger.debug(`Repository info received: "${formatJson(repositoryInfo)}"`);
  } catch (e) {
    reportError(
      'Cannot get repository information from Zeus. Check your configuration and credentials. ' +
        `Error: ${e.message}`
    );
  }

  await statusProvider.waitForTheBuildToSucceed(revision);
}

/**
 * Deals with the release branch after publishing is done
 *
 * Leave the release branch unmerged, or merge it but not delete it if the
 * corresponding flags are set.
 *
 * @param github Github client
 * @param githubConfig Github repository configuration
 * @param branchName Release branch name
 * @param skipMerge If set to "true", the branch will not be merged
 * @param keepBranch If set to "true", the branch will not be deleted
 */
async function handleReleaseBranch(
  github: Github,
  githubConfig: GithubGlobalConfig,
  branchName: string,
  skipMerge = false,
  keepBranch = false
): Promise<void> {
  if (!branchName || skipMerge) {
    logger.info('Skipping the merge step.');
    return;
  }

  logger.debug(`Merging the release branch: ${branchName}`);
  if (!isDryRun()) {
    await mergeReleaseBranch(
      github,
      githubConfig.owner,
      githubConfig.repo,
      branchName
    );
  } else {
    logger.info('[dry-run] Not merging the release branch');
  }

  if (keepBranch) {
    logger.info('Not deleting the release branch.');
  } else {
    const ref = `heads/${branchName}`;
    logger.debug(`Deleting the release branch, ref: ${ref}`);
    if (!isDryRun()) {
      const response = await github.git.deleteRef({
        owner: githubConfig.owner,
        ref,
        repo: githubConfig.repo,
      });
      logger.debug(
        `Deleted ref "${ref}"`,
        `Response status: ${response.status}`
      );
      logger.info(`Removed the remote branch: "${branchName}"`);
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
    logger.info('Not running the post-release command: no command specified');
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
  const additionalEnv = {
    CRAFT_NEW_VERSION: newVersion,
    CRAFT_OLD_VERSION: '',
  };
  await spawnProcess(sysCommand as string, args as string[], {
    env: { ...process.env, ...additionalEnv },
  });
  return true;
}

/**
 * Body of 'publish' command
 *
 * @param argv Command-line arguments
 */
export async function publishMain(argv: PublishOptions): Promise<any> {
  logger.debug('Argv:', JSON.stringify(argv));
  checkMinimalConfigVersion();

  // Get publishing configuration
  const config = getConfiguration() || {};
  const githubConfig = config.github;
  const githubClient = getGithubClient();

  const newVersion = argv.newVersion;

  logger.info(`Publishing version: "${newVersion}"`);

  let revision: string;
  let branchName;
  if (argv.rev) {
    branchName = '';
    logger.debug(
      `Fetching GitHub information for provided revision: "${argv.rev}"`
    );
    const response = await githubClient.repos.getCommit({
      owner: githubConfig.owner,
      ref: argv.rev,
      repo: githubConfig.repo,
    });
    revision = response.data.sha;
  } else {
    // Find the remote branch
    const branchPrefix =
      config.releaseBranchPrefix || DEFAULT_RELEASE_BRANCH_NAME;
    branchName = `${branchPrefix}/${newVersion}`;

    logger.debug('Fetching branch information', branchName);
    const response = await githubClient.repos.getBranch({
      branch: branchName,
      owner: githubConfig.owner,
      repo: githubConfig.repo,
    });
    revision = response.data.commit.sha;
  }
  logger.debug('Revision to publish: ', revision);

  const statusProvider = getStatusProviderFromConfig();
  const artifactProvider = getArtifactProviderFromConfig();
  logger.info(`Using "${statusProvider.constructor.name}" for status checks`);
  logger.info(`Using "${artifactProvider.constructor.name}" for artifacts`);

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

  logger.info(`Looking for publish state file for ${newVersion}...`);
  const publishStateFile = `.craft-publish-${newVersion}.json`;
  const earlierStateExists = existsSync(publishStateFile);
  let publishState: PublishState;
  if (earlierStateExists) {
    logger.info(`Found publish state file, resuming from there...`);
    publishState = JSON.parse(readFileSync(publishStateFile).toString());
    targetsToPublish = new Set(getAllTargetNames());
  } else {
    publishState = { published: Object.create(null) };
  }

  for (const published of Object.keys(publishState.published)) {
    logger.info(
      `Skipping target ${published} as it is marked as successful in state file.`
    );
    targetsToPublish.delete(published);
  }

  let targetConfigList = config.targets || [];

  if (!targetsToPublish.has(SpecialTarget.All)) {
    targetConfigList = targetConfigList.filter(targetConf =>
      targetsToPublish.has(getTargetId(targetConf))
    );
  }

  if (!targetsToPublish.has(SpecialTarget.None) && !earlierStateExists) {
    if (targetConfigList.length === 0) {
      logger.warn('No valid targets detected! Exiting.');
      return undefined;
    }

    logger.debug('Initializing targets');
    const targetList: BaseTarget[] = [];
    for (const targetConfig of targetConfigList) {
      const targetClass = getTargetByName(targetConfig.name);
      const targetDescriptor = getTargetId(targetConfig);
      if (!targetClass) {
        logger.warn(
          `Target implementation for "${targetDescriptor}" not found.`
        );
        continue;
      }
      try {
        const target = new targetClass(targetConfig, artifactProvider);
        targetList.push(target);
      } catch (err) {
        logger.error(`Error creating target instance for ${targetDescriptor}!`);
        throw err;
      }
    }

    logger.info('Publishing to targets:');

    targetConfigList
      .map(getTargetId)
      .forEach(target => logger.info(`  - ${target}`));
    logger.info(' ');

    await promptConfirmation();

    await withTempDir(async (downloadDirectory: string) => {
      artifactProvider.setDownloadDirectory(downloadDirectory);

      // Publish to all targets
      for (const target of targetList) {
        await publishToTarget(target, newVersion, revision);
        publishState.published[getTargetId(target.config)] = true;
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

  if (argv.rev) {
    logger.info('Not merging any branches because revision was specified.');
  } else if (
           targetsToPublish.has(SpecialTarget.All) ||
           targetsToPublish.has(SpecialTarget.None) ||
           earlierStateExists
         ) {
           // Publishing done, MERGE DAT BRANCH!
           await handleReleaseBranch(
             githubClient,
             githubConfig,
             branchName,
             argv.noMerge,
             argv.keepBranch
           );
           if (!isDryRun()) {
             // intentionally DO NOT await unlinking
             fsPromises.unlink(publishStateFile);
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

export const handler = async (argv: PublishOptions): Promise<any> => {
  try {
    catchKeyboardInterrupt();
    return await publishMain(argv);
  } catch (e) {
    handleGlobalError(e);
  }
};
