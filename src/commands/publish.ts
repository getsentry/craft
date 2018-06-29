import { Argv } from 'yargs';

import { getConfiguration } from '../config';
import logger from '../logger';
import { ZeusStore } from '../stores/zeus';
import { getTargetByName } from '../targets';
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
    .demandOption('new-version', 'Please specify the version to publish');

/** Command line options. */
interface PublishOptions {
  rev?: string;
  target?: string | string[];
  newVersion: string;
  mergeReleaseBranch: boolean;
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
  targetConfigList: any[]
): Promise<any> {
  await withTempDir(async (downloadDirectory: string) => {
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
  });
}

/**
 * Entrypoint for 'publish' command
 *
 * @param argv Command-line arguments
 */
async function publishMain(argv: PublishOptions): Promise<any> {
  logger.debug('Argv:', JSON.stringify(argv));

  // Get repo configuration
  const config = getConfiguration() || {};
  const githubConfig = config.github;
  const githubClient = getGithubClient();

  let revision;
  let branchName = '';
  if (argv.rev) {
    revision = argv.rev;
  } else {
    // Check that the tag is a valid version string
    if (!isValidVersion(argv.newVersion)) {
      logger.error(`Invalid version provided: "${argv.newVersion}"`);
      return undefined;
    }

    // Find a remote branch
    branchName = `release/${argv.newVersion}`;
    logger.debug('Fetching branch information', branchName);
    const response = await githubClient.repos.getBranch({
      branch: branchName,
      owner: githubConfig.owner,
      repo: githubConfig.repo,
    });
    revision = response.data.commit.sha;
  }
  logger.debug('The revision to publish: ', revision);

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
    logger.warning('No targets detected! Exiting.');
    return undefined;
  }
  await publishToTargets(
    githubConfig.owner,
    githubConfig.repo,
    argv.newVersion,
    revision,
    targetConfigList
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
    logger.debug('Skipping the merge step');
  }
}

export const handler = async (argv: PublishOptions) => {
  try {
    return await publishMain(argv);
  } catch (e) {
    logger.error(e);
  }
};
