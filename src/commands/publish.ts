// tslint:disable:no-submodule-imports
import git = require('simple-git/promise');
import { Argv } from 'yargs';
import { getTargetByName } from '../targets';

import { getConfiguration } from '../config';
import { ZeusStore } from '../stores/zeus';
import { withTempDir } from '../utils/files';

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
    .option('tag', {
      alias: 'T',
      description: 'Version to publish',
      type: 'string',
    })
    .demandOption('tag', 'Please specify version (tag) to publish');

/** Command line options. */
interface PublishOptions {
  rev?: string;
  target?: string[];
  tag: string;
}

async function publishToTargets(
  version: string,
  revision: string,
  owner: string,
  repo: string,
  targetConfigList: any[]
): Promise<any> {
  await withTempDir(async downloadDirectory => {
    const store = new ZeusStore(owner, repo, downloadDirectory);
    for (const targetConfig of targetConfigList) {
      const targetClass = getTargetByName(targetConfig.name);
      if (!targetClass) {
        console.log(`WARNING: target "${targetConfig.name}" not found.`);
        return;
      }
      const target = new targetClass(targetConfig, store);
      await target.publish(version, revision);
    }
  });
}

export const handler = async (argv: PublishOptions) => {
  console.log(argv);

  try {
    let revision;
    if (argv.rev) {
      revision = argv.rev;
    } else {
      // Infer revision
      const repo = git('.').silent(true);
      revision = (await repo.revparse(['HEAD'])).trim();
    }
    console.log('The revision to pack: ', revision);

    // Get repo configuration
    const config = getConfiguration();
    const githubConfig = config.github;

    // Find targets
    let targetList: string[] =
      (typeof argv.target === 'string' ? [argv.target] : argv.target) || [];
    if (targetList.length > 1 && targetList.indexOf('all') > -1) {
      throw new Error('Target "all" specified together with other targets');
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
      console.log('WARNING: no targets detected! Exiting.');
      return;
    }
    await publishToTargets(
      argv.tag,
      revision,
      githubConfig.owner,
      githubConfig.repo,
      targetConfigList
    );
  } catch (e) {
    console.log(e);
  }
};
