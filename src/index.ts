#!/usr/bin/env node

import * as yargs from 'yargs';
import { error } from './logger';

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
    error(message || err.message);
    process.exit(1);
  }).argv;
