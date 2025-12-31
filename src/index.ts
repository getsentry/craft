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
import * as changelog from './commands/changelog';

function printVersion(): void {
  if (!process.argv.includes('-v') && !process.argv.includes('--version')) {
    // Print the current version
    logger.debug(`craft ${getPackageVersion()}`);
  }
}

const GLOBAL_BOOLEAN_FLAGS = {
  'no-input': {
    coerce: envToBool,
    default: isCI,
    describe: 'Suppresses all user prompts',
    global: true,
  },
  'dry-run': {
    coerce: envToBool,
    // TODO(byk): Deprecate this in favor of CRAFT_DRY_RUN
    default: process.env.DRY_RUN,
    global: true,
    describe: 'Dry run mode: no file writes, commits, pushes, or API mutations',
  },
};

/**
 * This function is to pre-process and fix one of yargs' shortcomings:
 * We want to use some flags as booleans: just their existence on the CLI should
 * set them to true. That said since we also allow setting them through
 * environment variables, we need to parse many string values that would set
 * them to false. Moreover, we want to be able to override already-set env
 * variables with the `--flag=no` kind of notation (using the `=` symbol) but
 * not via the positional argument notation (`--flag no`). The only way to do
 * this is to define them as string arguments and then _inject_ a truthy string
 * if we notice the flag is passed standalone (ie `--flag`).
 * @param argv The raw process.argv array
 * @returns The processed, injected version of the argv array to pass to yargs
 */
function fixGlobalBooleanFlags(argv: string[]): string[] {
  const result = [];
  for (const arg of argv) {
    result.push(arg);
    if (arg.slice(2) in GLOBAL_BOOLEAN_FLAGS) {
      result.push('1');
    }
  }
  return result;
}

/**
 * Main entrypoint
 */
async function main(): Promise<void> {
  printVersion();

  readEnvironmentConfig();

  initSentrySdk();

  const argv = fixGlobalBooleanFlags(process.argv.slice(2));

  await yargs()
    .parserConfiguration({
      'boolean-negation': false,
    })
    .env('CRAFT')
    .command(prepare)
    .command(publish)
    .command(targets)
    .command(config)
    .command(artifacts)
    .command(changelog)
    .demandCommand()
    .version(getPackageVersion())
    .alias('v', 'version')
    .help()
    .alias('h', 'help')
    .options(GLOBAL_BOOLEAN_FLAGS)
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
    .parse(argv);
}

main();
