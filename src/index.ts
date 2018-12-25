#!/usr/bin/env node
import { setDryRun } from 'dryrun';
import * as yargs from 'yargs';

import { logger } from './logger';
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

function processNoInput<T>(arg: T): T {
  if (arg) {
    process.env.CRAFT_NO_INPUT = '1';
  }
  return arg;
}

function processDryRun<T>(arg: T): T {
  if (arg) {
    setDryRun(true);
  }
  return arg;
}

// tslint:disable-next-line:no-unused-expression
yargs
  .commandDir('commands')
  .demandCommand()
  .version()
  .alias('v', 'version')
  .help()
  .alias('h', 'help')
  .option('no-input', {
    boolean: true,
    coerce: processNoInput,
    default: false,
    describe: 'No input',
  })
  .option('dry-run', {
    boolean: true,
    coerce: processDryRun,
    default: false,
    describe: 'Dry run',
  })
  .strict()
  .showHelpOnFail(true).argv;
