#!/usr/bin/env node

import * as updateNotifier from 'update-notifier';
import * as yargs from 'yargs';

import logger from './logger';

// tslint:disable-next-line:no-var-requires
const pkg = require('../package.json');

// Notify if the new version is available
const notifier = updateNotifier({
  pkg,
  updateCheckInterval: 0, // 1 hour
});
notifier.notify({ defer: false });

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
