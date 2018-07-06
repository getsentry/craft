import chalk from 'chalk';
import { prompt, Question } from 'inquirer';
import * as ora from 'ora';
import { Argv } from 'yargs';

import { log } from '../../logger';

export const command = ['demo', 'd'];
export const description = '🎬 Run a demo of craft';

export const builder = (yargs: Argv) =>
  yargs.option('m', {
    alias: 'message',
    description: 'Message to print when done',
    type: 'string',
  });

/** Command line options. */
interface DemoOptions {
  message?: string;
}

/** Inquirer answers. */
interface DemoAnswers {
  message?: string;
  ready: boolean;
}

export const handler = async (argv: DemoOptions) => {
  const questions: Array<Question<DemoAnswers>> = [
    {
      message: 'What should I print in the end?',
      name: 'message',
      type: 'input',
      when: () => !argv.message,
    },
    {
      message: 'Ready?',
      name: 'ready',
      type: 'confirm',
    },
  ];

  const answers = await prompt(questions);
  log();

  if (!answers.ready) {
    log(':eyes:  Maybe next time...');
    return;
  }

  const message = answers.message || argv.message;
  if (!message) {
    throw new Error('You need to enter a message');
  }

  const spinner = ora('Performing important stuff, trust me').start();
  await new Promise<void>(resolve => setTimeout(resolve, 2000));
  spinner.stop();

  log(':tada:  %s! %s', chalk.green('Woooho'), chalk.dim(message));
};
