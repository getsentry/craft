#!/usr/bin/env node
import * as yargs from 'yargs';

import logger from './logger';
import { checkForUpdates } from './utils/version';

checkForUpdates();

// tslint:disable-next-line:no-var-requires
const pkg = require('../package.json');
// Print the current version
logger.info(`craft ${pkg.version}`);

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
