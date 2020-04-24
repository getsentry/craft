import { Argv } from 'yargs';

export const command = ['artifacts <command>'];
export const aliases = ['a', 'artifact'];
export const description = '📦 Manage artifacts';

/**
 * Common options for `artifacts` commands
 */
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
