#!/usr/bin/env node
import once from 'once';
import yargs from 'yargs';

import { logger, init as initLogger } from './logger';
import { readEnvironmentConfig } from './utils/env';
import { isDryRun } from './utils/helpers';
import { hasNoInput, setNoInput } from './utils/noInput';
import { initSentrySdk } from './utils/sentry';
import { getPackageVersion } from './utils/version';

// Commands
import * as prepare from './commands/prepare';
import * as publish from './commands/publish';
import * as targets from './commands/targets';
import * as config from './commands/config';
import * as artifacts from './commands/artifacts';

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
    logger.debug('[no-input] The script will not accept any input!');
  }
  return arg;
}

/**
 * Prints the current version
 */
function printVersion(): void {
  if (!process.argv.includes('-v') && !process.argv.includes('--version')) {
    // Print the current version
    logger.debug(`craft ${getPackageVersion()}`);
  }
}

/**
 * Main entrypoint
 */
function main(): void {
  printVersion();

  readEnvironmentConfig();

  initLogger();

  initSentrySdk();

  yargs
    .parserConfiguration({
      'boolean-negation': false,
    })
    .command(prepare)
    .command(publish)
    .command(targets)
    .command(config)
    .command(artifacts)
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
