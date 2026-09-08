import { Argv, CommandBuilder } from 'yargs';

import * as list from './workspace_cmds/list';

export const command = ['workspace <command>'];
export const description = 'Manage release workspaces';

export const builder: CommandBuilder = (yargs: Argv) =>
  yargs.demandCommand().command(list);

export const handler = (): void => {
  /* pass */
};
