import { Argv } from 'yargs';

export const command = ['artifacts'];
export const aliases = ['a', 'artifact'];
export const description = '📦 Manage artifacts';

/** TODO */
export interface ArtifactsOptions {
  rev: string;
}

export const builder = (yargs: Argv) =>
  yargs
    .option('rev', {
      alias: 'r',
      description: 'Revision',
      type: 'string',
    })
    .demandCommand()
    .demandOption('rev', 'Please specify the revision')
    .commandDir('artifacts_cmds');
