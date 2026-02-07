import { appendFileSync } from 'fs';

import prompts from 'prompts';
import { logger, LogLevel, setLevel } from '../logger';

const FALSY_ENV_VALUES = new Set(['', 'undefined', 'null', '0', 'false', 'no']);
export function envToBool(envVar: unknown): boolean {
  const normalized = String(envVar).toLowerCase();
  return !FALSY_ENV_VALUES.has(normalized);
}

export interface GlobalFlags {
  [flag: string]: unknown;
  'dry-run'?: boolean;
  'no-input'?: boolean;
  'log-level'?: keyof typeof LogLevel;
}

/** Internal type with required values (initialized with defaults) */
interface InternalGlobalFlags {
  'dry-run': boolean;
  'no-input': boolean;
  'log-level': keyof typeof LogLevel;
}

const GLOBAL_FLAGS: InternalGlobalFlags = {
  'dry-run': false,
  'no-input': false,
  'log-level': 'Info',
};

export function setGlobals(argv: GlobalFlags): void {
  if (argv['dry-run'] !== undefined) {
    GLOBAL_FLAGS['dry-run'] = argv['dry-run'];
  }
  if (argv['no-input'] !== undefined) {
    GLOBAL_FLAGS['no-input'] = argv['no-input'];
  }
  if (argv['log-level'] !== undefined) {
    GLOBAL_FLAGS['log-level'] = argv['log-level'];
  }
  logger.trace('Global flags:', GLOBAL_FLAGS);
  setLevel(LogLevel[GLOBAL_FLAGS['log-level']]);
  logger.trace('Argv: ', argv);
}

export function isDryRun(): boolean {
  return GLOBAL_FLAGS['dry-run'];
}

/**
 * Prompt the user that everything is OK and we should proceed
 */
export async function promptConfirmation(): Promise<void> {
  if (hasInput()) {
    const { isReady } = await prompts({
      message: 'Is everything OK? Type "yes" to proceed:',
      name: 'isReady',
      type: 'text',
      // Force the user to type something that is not empty or one letter such
      // as y/n to make sure this is a concious choice.
      validate: (input: string) =>
        input.length >= 2 || 'Please type "yes" to proceed',
    });
    if (isReady.toLowerCase() !== 'yes') {
      logger.error('Oh, okay. Aborting.');
      process.exit(1);
    }
  } else {
    logger.debug('Skipping the confirmation prompt.');
  }
}

export function hasInput(): boolean {
  return !GLOBAL_FLAGS['no-input'];
}

/**
 * Sets a GitHub Actions output variable.
 * Automatically uses heredoc-style delimiter syntax for multiline values.
 * No-op when not running in GitHub Actions.
 */
export function setGitHubActionsOutput(name: string, value: string): void {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) {
    return;
  }

  if (value.includes('\n')) {
    // Use heredoc-style delimiter for multiline values
    const delimiter = `EOF_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    appendFileSync(
      outputFile,
      `${name}<<${delimiter}\n${value}\n${delimiter}\n`,
    );
  } else {
    appendFileSync(outputFile, `${name}=${value}\n`);
  }
}
