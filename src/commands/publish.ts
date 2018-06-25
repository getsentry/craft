// tslint:disable:no-submodule-imports
import git = require('simple-git/promise');
import { Argv } from 'yargs';
import { getTargetByName } from '../targets';

import { getConfiguration } from '../config';
import { ZeusStore } from '../stores/zeus';

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

export const handler = async (argv: PublishOptions) => {
  console.log(argv);

  try {
    let sha;
    if (argv.rev) {
      sha = argv.rev;
    } else {
      // Infer revision
      const repo = git('.').silent(true);
      sha = (await repo.revparse(['HEAD'])).trim();
    }
    console.log('The revision to pack: ', sha);

    // Get repo configuration
    const config = getConfiguration();
    const githubConfig = config.github;
    const store = new ZeusStore(githubConfig.owner, githubConfig.repo);

    // Iterate over targets
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
      console.log('WARNING: no targets detected!');
    }

    for (const targetConfig of targetConfigList) {
      const targetClass = getTargetByName(targetConfig.name);
      if (!targetClass) {
        console.log(`WARNING: target "${targetConfig.name}" not found.`);
        return;
      }
      const target = new targetClass(targetConfig, store);
      await target.publish(argv.tag, sha);
    }
  } catch (e) {
    console.log(e);
  }
};
