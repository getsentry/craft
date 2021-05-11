import isCI from 'is-ci';
import prompts from 'prompts';
import { logger } from '../logger';

const FALSY_ENV_VALUES = new Set(['', '0', 'false', 'no']);
function envToBool(envVar: string | undefined): boolean | undefined {
  if (envVar == null) {
    return undefined;
  }
  const normalized = envVar.toLowerCase();
  return !FALSY_ENV_VALUES.has(normalized);
}

/**
 * Returns true or false depending on the value of process.env.DRY_RUN.
 *
 * @returns false if DRY_RUN is unset or is set to '', 'false', '0', or 'no',
 * true otherwise
 */
export function isDryRun(): boolean {
  return envToBool(process.env.DRY_RUN) || false;
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

let _hasInput: boolean;
/**
 * Returns true if user input is allowed. Uses the is-ci module and
 * the value of CRAFT_NO_INPUT environment variable is checked for
 * a true-ish value.
 */
export function hasInput(clearCache = false): boolean {
  if (clearCache || _hasInput === undefined) {
    _hasInput = !(envToBool(process.env.CRAFT_NO_INPUT) ?? isCI);
  }

  return _hasInput;
}
