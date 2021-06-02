import prompts from 'prompts';
import { logger, LogLevel, setLevel } from '../logger';

const FALSY_ENV_VALUES = new Set(['', 'undefined', 'null', '0', 'false', 'no']);
export function envToBool(envVar: unknown): boolean {
  const normalized = String(envVar).toLowerCase();
  return !FALSY_ENV_VALUES.has(normalized);
}

interface GlobalFlags {
  [flag: string]: any;
  'dry-run': boolean;
  'no-input': boolean;
  'log-level': keyof typeof LogLevel;
}

const GLOBAL_FLAGS: GlobalFlags = {
  'dry-run': false,
  'no-input': false,
  'log-level': 'Info',
};

export function setGlobals(argv: GlobalFlags): void {
  for (const globalFlag of Object.keys(GLOBAL_FLAGS)) {
    GLOBAL_FLAGS[globalFlag] = argv[globalFlag];
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
