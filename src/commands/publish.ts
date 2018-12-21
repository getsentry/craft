import * as Github from '@octokit/rest';
import { isDryRun, shouldPerform } from 'dryrun';
import * as ora from 'ora';
import { Arguments, Argv } from 'yargs';

import { checkMinimalConfigVersion, getConfiguration } from '../config';
import logger from '../logger';
import { GithubGlobalConfig } from '../schemas/project_config';
import { RevisionInfo, ZeusStore } from '../stores/zeus';
import { getAllTargetNames, getTargetByName, SpecialTarget } from '../targets';
import { BaseTarget } from '../targets/base';
import { reportError } from '../utils/errors';
import { withTempDir } from '../utils/files';
import { getGithubClient, mergeReleaseBranch } from '../utils/githubApi';
import { catchKeyboardInterrupt, sleepAsync } from '../utils/system';
import { isValidVersion } from '../utils/version';

export const command = ['publish <new-version>', 'p'];
export const description = '🛫 Publish artifacts';

/** Max number of seconds to wait for revision to be available in Zeus */
const ZEUS_REVISION_INFO_POLLING_MAX = 60 * 10;

/** Max number of seconds to wait for the build to finish on Zeus */
const ZEUS_BUILD_STATUS_POLLING_MAX = 60 * 60;

/** Interval in seconds while polling Zeus status */
const ZEUS_POLLING_INTERVAL = 30;

export const builder = (yargs: Argv) =>
  yargs
    .positional('new-version', {
      description: 'Version to publish',
      type: 'string',
    })
    .option('target', {
      alias: 't',
      choices: getAllTargetNames().concat([
        SpecialTarget.All,
        SpecialTarget.None,
      ]),
      default: 'all',
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
      description: 'Do not check for build status in Zeus',
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
 * Checks prerequisites for "publish" command
 */
function checkPrerequisites(): void {
  if (!process.env.ZEUS_TOKEN && !process.env.ZEUS_API_TOKEN) {
    throw new Error(
      'ZEUS_API_TOKEN not found in the environment. See the documentation for more details.'
    );
  }
  if (process.env.ZEUS_TOKEN) {
    logger.warn(
      'Usage of ZEUS_TOKEN is deprecated, and will be removed in later versions. ' +
        'Please use ZEUS_API_TOKEN instead.'
    );
  } else {
    // We currently need ZEUS_TOKEN set for zeus-sdk to work properly
    process.env.ZEUS_TOKEN = process.env.ZEUS_API_TOKEN;
  }
}

/**
 * Checks that the passed version is a valid version string
 *
 * @param argv Parsed yargs arguments
 * @param _opt A list of options and aliases
 */
function checkVersion(argv: Arguments, _opt: any): any {
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
  githubConfig: GithubGlobalConfig,
  version: string,
  revision: string,
  targetConfigList: any[],
  keepDownloads: boolean = false
): Promise<void> {
  let downloadDirectoryPath;

  await withTempDir(async (downloadDirectory: string) => {
    downloadDirectoryPath = downloadDirectory;
    const store = new ZeusStore(
      githubConfig.owner,
      githubConfig.repo,
      downloadDirectory
    );
    const targetList: BaseTarget[] = [];

    // Initialize all targets first
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
        const target = new targetClass(targetConfig, store);
        targetList.push(target);
      } catch (e) {
        logger.error('Error creating target instance!');
        throw e;
      }
    }

    // Publish all the targets
    for (const target of targetList) {
      const publishMessage = `=== Publishing to target: "${target.name}" ===`;
      const delim = Array(publishMessage.length + 1).join('=');
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
 * Fetches revision information from Zeus
 *
 * If the revision is not found in Zeus, the function polls for it regularly.
 *
 * @param zeus Zeus store object
 * @param revision Git revision SHA
 */
async function getRevisionInformation(
  zeus: ZeusStore,
  revision: string
): Promise<RevisionInfo> {
  const spinner = ora({ spinner: 'bouncingBar' }) as any;

  let secondsPassed = 0;

  while (true) {
    try {
      const revisionInfo = await zeus.getRevision(revision);
      if (spinner.isSpinning) {
        spinner.succeed();
      }
      return revisionInfo;
    } catch (e) {
      const errorMessage: string = e.message || '';
      if (!errorMessage.match(/404 not found|resource not found/i)) {
        if (spinner.isSpinning) {
          spinner.fail();
        }
        throw e;
      }

      if (secondsPassed > ZEUS_REVISION_INFO_POLLING_MAX) {
        throw new Error(
          `Waited for more than ${ZEUS_REVISION_INFO_POLLING_MAX} seconds, and the revision is still not available. Aborting.`
        );
      }

      // Update the spinner
      const timeString = new Date().toLocaleString();
      const waitMessage = `[${timeString}] Revision ${revision} is not yet found in Zeus, retrying in ${ZEUS_POLLING_INTERVAL} seconds...`;
      spinner.text = waitMessage;
      spinner.start();
      await sleepAsync(ZEUS_POLLING_INTERVAL * 1000);
      secondsPassed += ZEUS_POLLING_INTERVAL;
    }
  }
}

/**
 * Waits for the builds to finish for the revision
 *
 * @param zeus Zeus store object
 * @param revision Git revision SHA
 */
async function waitForTheBuildToSucceed(
  zeus: ZeusStore,
  revision: string
): Promise<void> {
  const revisionUrl = zeus.client.getUrl(
    `/gh/${zeus.repoOwner}/${zeus.repoName}/revisions/${revision}`
  );

  // Status spinner
  const spinner = ora({ spinner: 'bouncingBar' }) as any;
  let secondsPassed = 0;
  let firstIteration = true;
  while (true) {
    const revisionInfo: RevisionInfo = await getRevisionInformation(
      zeus,
      revision
    );
    if (firstIteration) {
      logger.info(`Revision ${revision} has been found in Zeus.`);
      firstIteration = false;
    }

    const isSuccess = zeus.isRevisionBuiltSuccessfully(revisionInfo);
    const isFailure = zeus.isRevisionFailed(revisionInfo);

    if (isSuccess) {
      if (spinner.isSpinning) {
        spinner.succeed();
      }
      logger.info(`Revision ${revision} has been built successfully.`);
      return;
    }

    if (isFailure) {
      if (spinner.isSpinning) {
        spinner.fail();
      }
      reportError(
        `Build(s) for revision ${revision} have failed.` +
          `\nPlease check revision's status on Zeus: ${revisionUrl}`
      );
      return;
    }

    if (secondsPassed > ZEUS_BUILD_STATUS_POLLING_MAX) {
      throw new Error(
        `Waited for more than ${ZEUS_BUILD_STATUS_POLLING_MAX} seconds for the build to finish. Aborting.`
      );
    }

    // Update the spinner
    const timeString = new Date().toLocaleString();
    const waitMessage = `[${timeString}] CI builds are still in progress, sleeping for ${ZEUS_POLLING_INTERVAL} seconds...`;
    spinner.text = waitMessage;
    spinner.start();
    await sleepAsync(ZEUS_POLLING_INTERVAL * 1000);
    secondsPassed += ZEUS_POLLING_INTERVAL;
  }
  spinner.stop();
}

// TODO there is at least one case that is not covered: how to detect Zeus builds
// that have unknown status (neither failed nor succeeded)
/**
 * Checks statuses of all builds on Zeus for the provided revision
 *
 * @param githubConfig Github repository configuration
 * @param revision Git commit SHA to check
 * @param skipStatusCheckFlag A flag to enable/disable this check
 */
async function checkRevisionStatus(
  githubConfig: GithubGlobalConfig,
  revision: string,
  skipStatusCheckFlag: boolean = false
): Promise<void> {
  if (skipStatusCheckFlag) {
    logger.warn(`Skipping build status checks for revision ${revision}`);
    return;
  }

  const zeus = new ZeusStore(githubConfig.owner, githubConfig.repo);

  try {
    logger.debug('Fetching repository information from Zeus...');
    // This will additionally check that the user has proper permissions
    const repositoryInfo = await zeus.getRepositoryInfo();
    logger.debug(
      `Repository info received: "${repositoryInfo.owner_name}/${
        repositoryInfo.name
      }"`
    );
  } catch (e) {
    reportError(
      'Cannot get repository information from Zeus. Check your configuration and credentials. ' +
        `Error: ${e.message}`
    );
  }

  await waitForTheBuildToSucceed(zeus, revision);
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
      const response = await github.gitdata.deleteRef({
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
  if (isDryRun()) {
    logger.info('[dry-run] Dry-run mode is on!');
  }
  checkMinimalConfigVersion();
  checkPrerequisites();

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
      repo: githubConfig.repo,
      sha: argv.rev,
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

  // Check status of all CI builds linked to the revision
  await checkRevisionStatus(githubConfig, revision, argv.noStatusCheck);

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
  if (targetList[0] !== 'all') {
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
    await publishToTargets(
      githubConfig,
      newVersion,
      revision,
      targetConfigList,
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
    logger.error(e);
    process.exit(1);
  }
};
