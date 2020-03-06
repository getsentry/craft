import * as Github from '@octokit/rest';
import { shouldPerform } from 'dryrun';
import * as inquirer from 'inquirer';
import { Arguments, Argv } from 'yargs';
import chalk from 'chalk';
import * as stringLength from 'string-length';

import {
  checkMinimalConfigVersion,
  getConfiguration,
  getStatusProviderFromConfig,
  getArtifactProviderFromConfig,
} from '../config';
import { formatTable, logger } from '../logger';
import { GithubGlobalConfig } from '../schemas/project_config';
import { getAllTargetNames, getTargetByName, SpecialTarget } from '../targets';
import { BaseTarget } from '../targets/base';
import { checkEnvForPrerequisites } from '../utils/env';
import {
  coerceType,
  // ConfigurationError,
  handleGlobalError,
  reportError,
} from '../utils/errors';
import { withTempDir } from '../utils/files';
import { stringToRegexp } from '../utils/filters';
import { getGithubClient, mergeReleaseBranch } from '../utils/githubApi';
import { hasInput } from '../utils/noInput';
import { formatSize, formatJson } from '../utils/strings';
import { catchKeyboardInterrupt } from '../utils/system';
import { isValidVersion } from '../utils/version';
import { BaseStatusProvider } from '../status_providers/base';
import { BaseArtifactProvider } from '../artifact_providers/base';

export const command = ['publish NEW-VERSION'];
export const aliases = ['pp', 'publish'];
export const description = '🛫 Publish artifacts';

export const builder = (yargs: Argv) =>
  yargs
    .positional('NEW-VERSION', {
      description: 'Version to publish',
      type: 'string',
    })
    .option('target', {
      alias: 't',
      choices: getAllTargetNames().concat([
        SpecialTarget.All,
        SpecialTarget.None,
      ]),
      default: SpecialTarget.All,
      description: 'Publish to this target',
      type: 'string',
    })
    .option('rev', {
      alias: 'r',
      description: 'Source revision to publish',
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

/**
 * Checks Zeus prerequisites
 */
// function checkPrerequisites(): void {
//   if (!process.env.ZEUS_TOKEN && !process.env.ZEUS_API_TOKEN) {
//     throw new ConfigurationError(
//       'ZEUS_API_TOKEN not found in the environment. See the documentation for more details.'
//     );
//   }
//   if (process.env.ZEUS_TOKEN) {
//     logger.warn(
//       'Usage of ZEUS_TOKEN is deprecated, and will be removed in later versions. ' +
//         'Please use ZEUS_API_TOKEN instead.'
//     );
//   } else {
//     // We currently need ZEUS_TOKEN set for zeus-sdk to work properly
//     process.env.ZEUS_TOKEN = process.env.ZEUS_API_TOKEN;
//   }
// }

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
 * Publishes artifacts to the provided targets
 *
 * @param githubConfig Github repository configuration
 * @param version New version to be released
 * @param revision Git commit SHA of the commit to be published
 * @param targetConfigList A list of parsed target configurations
 * @param keepDownloads If "true", downloaded files will not be removed
 */
async function publishToTargets(
  version: string,
  revision: string,
  targetConfigList: any[],
  artifactProvider: BaseArtifactProvider,
  keepDownloads: boolean = false
): Promise<void> {
  let downloadDirectoryPath;

  await withTempDir(async (downloadDirectory: string) => {
    downloadDirectoryPath = downloadDirectory;
    artifactProvider.setDownloadDirectory(downloadDirectoryPath);
    const targetList: BaseTarget[] = [];

    // Initialize all targets first
    // TODO(tonyo): initialize them earlier!
    logger.debug('Initializing targets');
    for (const targetConfig of targetConfigList) {
      const targetClass = getTargetByName(targetConfig.name);
      if (!targetClass) {
        logger.warn(
          `Target implementation for "${targetConfig.name}" not found.`
        );
        continue;
      }
      try {
        const target = new targetClass(targetConfig, artifactProvider);
        targetList.push(target);
      } catch (e) {
        logger.error('Error creating target instance!');
        throw e;
      }
    }

    // Publish to all targets
    for (const target of targetList) {
      const publishMessage = `=== Publishing to target: ${chalk.bold(
        chalk.cyan(target.name)
      )} ===`;
      const delim = Array(stringLength(publishMessage) + 1).join('=');
      logger.info(' ');
      logger.info(delim);
      logger.info(publishMessage);
      logger.info(delim);
      await target.publish(version, revision);
    }
  }, !keepDownloads);

  if (keepDownloads) {
    logger.info(
      'Difectory with the downloaded artifacts will not be removed',
      `Path: ${downloadDirectoryPath}`
    );
  }
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
  if (artifacts && artifacts.length > 0) {
    const artifactData = artifacts.map(ar => [
      ar.name,
      formatSize(ar.file.size),
      ar.updated_at || '',
    ]);
    artifactData.sort((a1, a2) => (a1[0] < a2[0] ? -1 : a1[0] > a2[0] ? 1 : 0));
    const table = formatTable(
      {
        head: ['File Name', 'Size', 'Updated'],
        style: { head: ['cyan'] },
      },
      artifactData
    );
    logger.info(`Available artifacts: \n${table.toString()}\n`);
  } else if (!artifacts) {
    throw new Error(`Revision ${revision} not found!`);
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
  if (!artifacts) {
    throw new Error(`Revision ${revision} not found!`);
  }

  for (const nameRegexString of requiredNames) {
    const nameRegex = stringToRegexp(nameRegexString);
    const matchedArtifacts = artifacts.filter(artifact =>
      nameRegex.test(artifact.name)
    );
    if (matchedArtifacts.length === 0) {
      reportError(
        `No matching artifact found for the required pattern: ${nameRegexString}`
      );
    } else {
      logger.debug(
        `Artifact "${matchedArtifacts[0].name}" matches pattern ${nameRegexString}`
      );
    }
  }
  logger.debug('Check for "requiredNames" passed.');
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
  skipStatusCheckFlag: boolean = false
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
  skipMerge: boolean = false,
  keepBranch: boolean = false
): Promise<void> {
  if (!branchName || skipMerge) {
    logger.info('Skipping the merge step.');
    return;
  }

  logger.debug(`Merging the release branch: ${branchName}`);
  if (shouldPerform()) {
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
    if (shouldPerform()) {
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
 * Body of 'publish' command
 *
 * @param argv Command-line arguments
 */
export async function publishMain(argv: PublishOptions): Promise<any> {
  logger.debug('Argv:', JSON.stringify(argv));
  checkMinimalConfigVersion();
  checkEnvForPrerequisites([['ZEUS_API_TOKEN', 'ZEUS_TOKEN']]);
  // We currently need ZEUS_TOKEN set for zeus-sdk to work properly
  if (!process.env.ZEUS_TOKEN) {
    process.env.ZEUS_TOKEN = process.env.ZEUS_API_TOKEN;
  }

  // Get repo configuration
  const config = getConfiguration() || {};
  const githubConfig = config.github;
  const githubClient = getGithubClient();

  const newVersion = argv.newVersion;

  logger.info(`Publishing version: "${newVersion}"`);

  let revision;
  let branchName;
  if (argv.rev) {
    branchName = '';
    // TODO: allow to specify arbitrary git refs?
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
    branchName = `release/${newVersion}`;
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
  logger.info(`Using "${statusProvider.constructor.name}" for status checks`);
  const artifactProvider = getArtifactProviderFromConfig();
  logger.info(`Using "${artifactProvider.constructor.name}" for artifacts`);

  // Check status of all CI builds linked to the revision
  await checkRevisionStatus(statusProvider, revision, argv.noStatusCheck);

  // Find targets
  const targetList: string[] = (typeof argv.target === 'string'
    ? [argv.target]
    : argv.target) || [SpecialTarget.All];

  // Treat "all"/"none" specially
  for (const specialTarget of [SpecialTarget.All, SpecialTarget.None]) {
    if (targetList.length > 1 && targetList.indexOf(specialTarget) > -1) {
      logger.error(
        `Target "${specialTarget}" specified together with other targets. Exiting.`
      );
      return undefined;
    }
  }

  let targetConfigList = config.targets || [];

  if (targetList[0] !== SpecialTarget.All) {
    targetConfigList = targetConfigList.filter(
      (targetConf: { [key: string]: any }) =>
        targetList.indexOf(targetConf.name) > -1
    );
  }

  if (targetList[0] !== SpecialTarget.None) {
    if (!targetConfigList.length) {
      logger.warn('No valid targets detected! Exiting.');
      return undefined;
    }

    await printRevisionSummary(artifactProvider, revision);
    await checkRequiredArtifacts(
      artifactProvider,
      revision,
      config.requireNames
    );

    logger.info('Publishing to targets:');

    // TODO init all targets earlier
    targetConfigList
      .map(t => t.name || '__undefined__')
      .forEach(target => logger.info(`  - ${target}`));
    logger.info(' ');

    await promptConfirmation();

    await publishToTargets(
      newVersion,
      revision,
      targetConfigList,
      artifactProvider,
      argv.keepDownloads
    );
  }

  if (argv.rev) {
    logger.info('Not merging any branches because revision was specified.');
  } else if (
    targetList[0] === SpecialTarget.All ||
    targetList[0] === SpecialTarget.None
  ) {
    // Publishing done, MERGE DAT BRANCH!
    await handleReleaseBranch(
      githubClient,
      githubConfig,
      branchName,
      argv.noMerge,
      argv.keepBranch
    );
    logger.success(`Version ${newVersion} has been published!`);
  } else {
    const msg = [
      'The release branch was not merged because you published only to specific targets.',
      'After all the targets are published, run the following command to merge the release branch:',
      `  $ craft publish ${newVersion} --target none\n`,
    ];
    logger.warn(msg.join('\n'));
  }
}

export const handler = async (argv: PublishOptions) => {
  try {
    catchKeyboardInterrupt();
    return await publishMain(argv);
  } catch (e) {
    handleGlobalError(e);
  }
};
