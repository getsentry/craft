#!/usr/bin/env node
import * as yargs from 'yargs';

import logger from './logger';
import { checkForUpdates } from './utils/version';

checkForUpdates();

if (
  process.argv.indexOf('-v') === -1 &&
  process.argv.indexOf('--version') === -1
) {
  // tslint:disable-next-line:no-var-requires
  const pkg = require('../package.json');
  // Print the current version
  logger.info(`craft ${pkg.version}`);
}

// tslint:disable-next-line:no-unused-expression
yargs
  .commandDir('commands')
  .demandCommand()
  .version()
  .alias('v', 'version')
  .help()
  .alias('h', 'help')
  .strict()
  .showHelpOnFail(true).argv;
