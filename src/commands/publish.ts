import { isDryRun } from 'dryrun';
import { Argv } from 'yargs';

import { getConfiguration } from '../config';
import logger from '../logger';
import { ZeusStore } from '../stores/zeus';
import { getTargetByName } from '../targets';
import { reportError } from '../utils/errors';
import { withTempDir } from '../utils/files';
import { getGithubClient, mergeReleaseBranch } from '../utils/github_api';
import { isValidVersion } from '../utils/version';

export const command = ['publish', 'p'];
export const description = '🛫 Publish artifacts';

export const builder = (yargs: Argv) =>
  yargs
    .option('target', {
      alias: 't',
      choices: ['github', 'npm', 'pypi', 'all'],
      description: 'Publish to this target',
      type: 'string',
    })
    .option('rev', {
      alias: 'r',
      description: 'Source revision to publish',
      type: 'string',
    })
    .option('new-version', {
      alias: 'n',
      description: 'Version to publish',
      type: 'string',
    })
    .option('merge-release-branch', {
      default: true,
      description: 'Merge the release branch after publishing',
      type: 'boolean',
    })
    .option('remove-downloads', {
      default: true,
      description: 'Remove all downloaded files after each invocation',
      type: 'boolean',
    })
    .option('check-build-status', {
      default: true,
      description: 'Check that all builds successed before publishing',
      type: 'boolean',
    })
    .demandOption('new-version', 'Please specify the version to publish');

/** Command line options. */
interface PublishOptions {
  rev?: string;
  target?: string | string[];
  newVersion: string;
  mergeReleaseBranch: boolean;
  removeDownloads: boolean;
  checkBuildStatus: boolean;
}

/**
 * Publishes artifacts to the provided targets
 *
 * @param owner Repository owner
 * @param repo Repository name
 * @param version New version to be released
 * @param revision Git commit SHA of the commit to be published
 * @param targetConfigList A list of parsed target configurations
 */
async function publishToTargets(
  owner: string,
  repo: string,
  version: string,
  revision: string,
  targetConfigList: any[],
  removeDownloads: boolean = true
): Promise<void> {
  let downloadDirectoryPath;
  await withTempDir(async (downloadDirectory: string) => {
    downloadDirectoryPath = downloadDirectory;
    const store = new ZeusStore(owner, repo, downloadDirectory);
    for (const targetConfig of targetConfigList) {
      const targetClass = getTargetByName(targetConfig.name);
      if (!targetClass) {
        logger.warn(
          `Target implementation for "${targetConfig.name}" not found.`
        );
        continue;
      }
      const target = new targetClass(targetConfig, store);
      logger.debug(`Publishing to the target: "${targetConfig.name}"`);
      await target.publish(version, revision);
    }
  }, removeDownloads);

  if (!removeDownloads) {
    logger.info(
      'Difectory with the downloaded artifacts will not be removed',
      `Path: ${downloadDirectoryPath}`
    );
  }
}

/**
 * Checks statuses of all builds on Zeus for the provided revision
 *
 * @param owner Repository owner
 * @param repo Repository name
 * @param revision Git commit SHA to check
 * @param checkBuildStatusFlag A command line flag to enable/disable this check
 */
async function checkRevisionStatus(
  owner: string,
  repo: string,
  revision: string,
  checkBuildStatusFlag: boolean = true
): Promise<void> {
  if (!checkBuildStatusFlag) {
    logger.warn(`Skipping build status checks for revision ${revision}`);
    return undefined;
  }

  try {
    const zeus = new ZeusStore(owner, repo);
    const revisionInfo = await zeus.getRevision(revision);

    if (zeus.isRevisionBuiltSuccessfully(revisionInfo)) {
      logger.info(`Revision ${revision} has been built successfully.`);
    } else {
      // TODO add a Zeus link to the revision page
      reportError(
        `Build(s) for revision ${revision} have not completed successfully (yet).`
      );
    }
  } catch (e) {
    if (e.err === 404) {
      throw new Error(`Revision ${revision} not found in Zeus.`);
    }
    throw e;
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
    // Check that the tag is a valid version string
    if (!isValidVersion(newVersion)) {
      logger.error(`Invalid version provided: "${newVersion}"`);
      return undefined;
    }

    // Find a remote branch
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
    argv.checkBuildStatus
  );

  // Find targets
  let targetList: string[] =
    (typeof argv.target === 'string' ? [argv.target] : argv.target) || [];
  if (targetList.length > 1 && targetList.indexOf('all') > -1) {
    logger.error('Target "all" specified together with other targets');
    return undefined;
  }
  // No targets specified => run all
  if (!targetList.length) {
    targetList = ['all'];
  }

  let targetConfigList = config.targets;
  if (targetList[0] !== 'all') {
    targetConfigList = targetConfigList.filter(
      (targetConf: { [key: string]: any }) =>
        targetList.indexOf(targetConf.name) > -1
    );
  }
  if (!targetConfigList.length) {
    logger.warn('No targets detected! Exiting.');
    return undefined;
  }
  await publishToTargets(
    githubConfig.owner,
    githubConfig.repo,
    newVersion,
    revision,
    targetConfigList,
    argv.removeDownloads
  );

  // Publishing done, MERGE DAT BRANCH!
  if (branchName && argv.mergeReleaseBranch) {
    await mergeReleaseBranch(
      githubClient,
      githubConfig.owner,
      githubConfig.repo,
      branchName
    );
  } else {
    logger.debug('Skipping the merge step.');
  }
  logger.success(`Version ${newVersion} has been published!`);
}

export const handler = async (argv: PublishOptions) => {
  try {
    return await publishMain(argv);
  } catch (e) {
    logger.error(e);
  }
};
