import * as Github from '@octokit/rest';
import { isDryRun, shouldPerform } from 'dryrun';
import * as ora from 'ora';
import { Arguments, Argv } from 'yargs';

import { getConfiguration } from '../config';
import logger from '../logger';
import { ZeusStore } from '../stores/zeus';
import { getTargetByName } from '../targets';
import { BaseTarget } from '../targets/base';
import { reportError } from '../utils/errors';
import { withTempDir } from '../utils/files';
import { getGithubClient, mergeReleaseBranch } from '../utils/github_api';
import { sleepAsync } from '../utils/system';
import { isValidVersion } from '../utils/version';

export const command = ['publish <new-version>', 'p'];
export const description = '🛫 Publish artifacts';

export const builder = (yargs: Argv) =>
  yargs
    .positional('new-version', {
      description: 'Version to publish',
      type: 'string',
    })
    .option('target', {
      alias: 't',
      choices: ['github', 'npm', 'pypi', 'all', 'none'],
      default: 'all',
      description: 'Publish to this target',
      type: 'string',
    })
    .option('rev', {
      alias: 'r',
      description: 'Source revision to publish',
      type: 'string',
    })
    .option('skip-merge', {
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
    .option('skip-status-check', {
      default: false,
      description: 'Do not check for build status in Zeus',
      type: 'boolean',
    })
    .check(checkVersion)
    .demandOption('new-version', 'Please specify the version to publish');

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

/** Command line options. */
interface PublishOptions {
  rev?: string;
  target?: string | string[];
  newVersion: string;
  skipMerge: boolean;
  keepDownloads: boolean;
  skipStatusCheck: boolean;
  keepBranch: boolean;
}

/** Interval in seconds while polling Zeus status */
const ZEUS_POLLING_INTERVAL = 30;

/**
 * Publishes artifacts to the provided targets
 *
 * @param owner Repository owner
 * @param repo Repository name
 * @param version New version to be released
 * @param revision Git commit SHA of the commit to be published
 * @param targetConfigList A list of parsed target configurations
 * @param keepDownloads If "true", downloaded files will not be removed
 */
async function publishToTargets(
  owner: string,
  repo: string,
  version: string,
  revision: string,
  targetConfigList: any[],
  keepDownloads: boolean = false
): Promise<void> {
  let downloadDirectoryPath;

  await withTempDir(async (downloadDirectory: string) => {
    downloadDirectoryPath = downloadDirectory;
    const store = new ZeusStore(owner, repo, downloadDirectory);
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
      const target = new targetClass(targetConfig, store);
      targetList.push(target);
    }

    // Publish all the targets
    for (const target of targetList) {
      const publishMessage = `=== Publishing to the target: "${
        target.name
      }" ===`;
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

// TODO there is at least one case that is not covered: how to detect Zeus builds
// that have unknown status (neither failed nor succeeded)
/**
 * Checks statuses of all builds on Zeus for the provided revision
 *
 * @param owner Repository owner
 * @param repo Repository name
 * @param revision Git commit SHA to check
 * @param skipStatusCheckFlag A flag to enable/disable this check
 */
async function checkRevisionStatus(
  owner: string,
  repo: string,
  revision: string,
  skipStatusCheckFlag: boolean = false
): Promise<void> {
  if (skipStatusCheckFlag) {
    logger.warn(`Skipping build status checks for revision ${revision}`);
    return;
  }
  // Status spinner
  const spinner = ora({ spinner: 'bouncingBar' }) as any;

  try {
    const zeus = new ZeusStore(owner, repo);

    while (true) {
      if (!spinner.isSpinning) {
        logger.debug('Getting revision info from Zeus...');
      }
      const revisionInfo = await zeus.getRevision(revision);

      const isSuccess = zeus.isRevisionBuiltSuccessfully(revisionInfo);
      const isFailure = zeus.isRevisionFailed(revisionInfo);

      if (isSuccess) {
        if (spinner) {
          spinner.succeed();
        }
        logger.info(`Revision ${revision} has been built successfully.`);
        return;
      }

      if (isFailure) {
        spinner.fail();
        const revisionUrl = zeus.client.getUrl(
          `/gh/${owner}/${repo}/revisions/${revision}`
        );
        // TODO add a Zeus link to the revision page
        reportError(
          `Build(s) for revision ${revision} have failed.` +
            `\nPlease check revision's status on Zeus: ${revisionUrl}`
        );
        return;
      }

      // Update the spinner
      const timeString = new Date()
        .toISOString()
        .replace(/T/, ' ')
        .replace(/\..+/, '');
      const waitMessage = `[${timeString}] CI builds are still in progress, sleeping for ${ZEUS_POLLING_INTERVAL} seconds...`;
      spinner.start();
      spinner.text = waitMessage;
      await sleepAsync(ZEUS_POLLING_INTERVAL * 1000);
    }
  } catch (e) {
    const errorMessage: string = e.message || '';
    if (errorMessage.match(/404 not found|resource not found/i)) {
      reportError(`Revision ${revision} not found in Zeus.`);
    } else {
      throw e;
    }
  } finally {
    spinner.stop();
  }
}

/**
 * Deals with the release branch after publishing is done
 *
 * Leave the release branch unmerged, or merge it but not delete it if the
 * corresponding flags are set.
 *
 * @param github Github client
 * @param owner Repository owner
 * @param repo Repository name
 * @param branchName Release branch name
 * @param skipMerge If set to "true", the branch will not be merged
 * @param keepBranch If set to "true", the branch will not be deleted
 */
async function handleReleaseBranch(
  github: Github,
  owner: string,
  repo: string,
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
    await mergeReleaseBranch(github, owner, repo, branchName);
  } else {
    logger.info('[dry-run] Not merging the release branch');
  }

  if (keepBranch) {
    logger.info('Not deleting the release branch.');
  } else {
    const ref = `heads/${branchName}`;
    logger.debug(`Deleting the release branch, ref: ${ref}`);
    if (shouldPerform()) {
      const response = await github.gitdata.deleteReference({
        owner,
        ref,
        repo,
      });
      logger.debug(
        `Deleted ref "${ref}"`,
        `Response status: ${response.status}`
      );
      logger.info(`Removed the remote branch: ${branchName}`);
    } else {
      logger.info('[dry-run] Not deleting the remote branch');
    }
  }
}

/**
 * Entrypoint for 'publish' command
 *
 * @param argv Command-line arguments
 */
async function publishMain(argv: PublishOptions): Promise<any> {
  logger.debug('Argv:', JSON.stringify(argv));
  if (isDryRun()) {
    logger.info('[dry-run] Dry-run mode is on!');
  }

  // Get repo configuration
  const config = getConfiguration() || {};
  const githubConfig = config.github;
  const githubClient = getGithubClient();

  const newVersion = argv.newVersion;

  logger.info(`Publishing the version: ${newVersion}`);

  let revision;
  let branchName;
  if (argv.rev) {
    logger.debug(
      `Fetching GitHub information for provided revision: ${argv.rev}`
    );
    const response = await githubClient.repos.getCommit({
      owner: githubConfig.owner,
      repo: githubConfig.repo,
      sha: argv.rev,
    });
    revision = response.data.sha;
    branchName = '';
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
  await checkRevisionStatus(
    githubConfig.owner,
    githubConfig.repo,
    revision,
    argv.skipStatusCheck
  );

  // Find targets
  const targetList: string[] = (typeof argv.target === 'string'
    ? [argv.target]
    : argv.target) || ['all'];

  // Treat "all"/"none" specially
  for (const specialTarget of ['all', 'none']) {
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

  if (targetList[0] !== 'none') {
    if (!targetConfigList.length) {
      logger.warn('No valid targets detected! Exiting.');
      return undefined;
    }
    await publishToTargets(
      githubConfig.owner,
      githubConfig.repo,
      newVersion,
      revision,
      targetConfigList,
      argv.keepDownloads
    );
  }

  // Publishing done, MERGE DAT BRANCH!
  await handleReleaseBranch(
    githubClient,
    githubConfig.owner,
    githubConfig.repo,
    branchName,
    argv.skipMerge,
    argv.keepBranch
  );

  logger.success(`Version ${newVersion} has been published!`);
}

export const handler = async (argv: PublishOptions) => {
  try {
    return await publishMain(argv);
  } catch (e) {
    logger.error(e);
  }
};
