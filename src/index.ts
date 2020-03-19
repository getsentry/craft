#!/usr/bin/env node
import * as once from 'once';
import * as yargs from 'yargs';

import { readEnvironmentConfig } from './utils/env';
import { logger } from './logger';
import { isDryRun } from './utils/helpers';
import { hasNoInput, setNoInput } from './utils/noInput';
import { initSentrySdk } from './utils/sentry';
import { checkForUpdates, getPackageVersion } from './utils/version';

/**
 * Handler for '--dry-run' option
 */
function processDryRun<T>(arg: T): T {
  // if the user explicitly set the flag on the command line, their choice
  // should override any previously set env var
  if (process.argv.indexOf('--dry-run') > -1) {
    process.env.DRY_RUN = String(arg);
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
  if (hasNoInput()) {
    logger.info('[no-input] The script will not accept any input!');
  }
  return arg;
}

/**
 * Prints the current version
 */
function printVersion(): void {
  if (
    process.argv.indexOf('-v') === -1 &&
    process.argv.indexOf('--version') === -1
  ) {
    // Print the current version
    logger.info(`craft ${getPackageVersion()}`);
  }
}

/**
 * Main entrypoint
 */
function main(): void {
  checkForUpdates();

  printVersion();

  readEnvironmentConfig();

  initSentrySdk();

  // tslint:disable-next-line:no-unused-expression
  yargs
    .parserConfiguration({
      'boolean-negation': false,
    })
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
      describe: 'Suppresses all user prompts',
    })
    .global('no-input')
    .option('dry-run', {
      boolean: true,
      coerce: once(processDryRun),
      default: false,
      describe: 'Dry run mode: do not perform any real actions',
    })
    .global('dry-run')
    .strict()
    .showHelpOnFail(true)
    .parse();
}

main();
