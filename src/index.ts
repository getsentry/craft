#!/usr/bin/env node
import { isDryRun, setDryRun } from 'dryrun';
import * as once from 'once';
import * as yargs from 'yargs';

import { logger } from './logger';
import { isNoInput, setNoInput } from './utils/noInput';
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

/**
 * Handler for '--dry-run' option
 */
function processDryRun<T>(arg: T): T {
  if (arg) {
    setDryRun(true);
  }
  if (isDryRun()) {
    logger.info('[dry-run] Dry-run mode is on!');
  }
  return arg;
}

/**
 * Handler for '--no-input' option
 */
function processNoInput<T>(arg: T): T {
  if (arg) {
    setNoInput(true);
  }
  if (isNoInput()) {
    logger.info('[no-input] The script will not accept any input!');
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
    coerce: once(processNoInput),
    default: false,
    describe: 'No input',
  })
  .global('no-input')
  .option('dry-run', {
    boolean: true,
    coerce: once(processDryRun),
    default: false,
    describe: 'Dry run',
  })
  .global('dry-run')
  .strict()
  .showHelpOnFail(true).argv;
