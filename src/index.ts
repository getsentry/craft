#!/usr/bin/env node

import chalk from 'chalk';
import * as yargs from 'yargs';

// tslint:disable-next-line:no-unused-expression
yargs
  .commandDir('commands')
  .demandCommand()
  .version()
  .alias('v', 'version')
  .help()
  .alias('h', 'help')
  .strict()
  .fail((message, err) => {
    const display = message || err.message;
    console.error('❗ %s %s.', chalk.red('error'), display);
    process.exit(1);
  }).argv;
