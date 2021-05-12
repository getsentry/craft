#!/usr/bin/env node
import isCI from 'is-ci';
import yargs from 'yargs';

import { logger, LogLevel } from './logger';
import { readEnvironmentConfig } from './utils/env';
import { envToBool, setGlobals } from './utils/helpers';
import { initSentrySdk } from './utils/sentry';
import { getPackageVersion } from './utils/version';

// Commands
import * as prepare from './commands/prepare';
import * as publish from './commands/publish';
import * as targets from './commands/targets';
import * as config from './commands/config';
import * as artifacts from './commands/artifacts';

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

  initSentrySdk();

  yargs
    .parserConfiguration({
      'boolean-negation': false,
    })
    .env('CRAFT')
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
      coerce: envToBool,
      default: isCI,
      describe: 'Suppresses all user prompts',
      global: true,
    })
    .option('dry-run', {
      coerce: envToBool,
      // TODO(byk): Deprecate this in favor of CRAFT_DRY_RUN
      default: process.env.DRY_RUN,
      global: true,
      describe: 'Dry run mode: do not perform any real actions',
    })
    .option('log-level', {
      default: 'Info',
      choices: Object.keys(LogLevel).filter(level => isNaN(Number(level))),
      coerce: level => level[0].toUpperCase() + level.slice(1).toLowerCase(),
      describe: 'Logging level',
      global: true,
    })
    .strictCommands()
    .showHelpOnFail(true)
    .middleware(setGlobals)
    .parse();
}

main();
