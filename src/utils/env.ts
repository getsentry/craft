import { existsSync } from 'fs';
import { join } from 'path';
// XXX(BYK): This is to be able to spy on `homedir()` in tests
// TODO(BYK): Convert this to ES6 imports
import os = require('os');

import { getConfigFileDir } from '../config';
import { ConfigurationError } from './errors';
import { logger } from '../logger';

/**
 * Legacy filename no longer read by Craft. Retained as a constant for the
 * startup warning helper below.
 */
const LEGACY_ENV_FILE_NAME = '.craft.env';

/**
 * A token, key, or other value which can be stored either in an env file or
 * directly in the environment
 */
export interface RequiredConfigVar {
  /**
   * The currently-preferred name of the variable, generally something in
   * UPPER_SNAKE_CASE
   */
  name: string;
  /** A deprecated (but still allowed) name for the variable, if any */
  legacyName?: string;
}

/**
 * Checks the environment for a single variable, taking into account its legacy
 * name, if applicable.
 *
 * Copies value over to live under current name if only found under legacy name.
 *
 * @param envVar a RequiredConfigVar object to check for
 * @returns true if variable was found, under either current or legacy name,
 * false otherwise
 */
function envHasVar(envVar: RequiredConfigVar): boolean {
  const { name, legacyName } = envVar;

  logger.debug('Checking for environment variable:', name);

  // not found, under either the current name or legacy name (if app.)
  if (!process.env[name] && !process.env[legacyName as string]) {
    return false;
  }

  // now we know it's there *somewhere*...

  // the simple cases - either no legacy name or legacy name not in use
  if (!legacyName || !process.env[legacyName]) {
    logger.debug(`Found ${name}`);
  }

  // the less simple cases - only using legacy name or using both
  else if (process.env[legacyName] && !process.env[name]) {
    logger.warn(
      `Usage of ${legacyName} is deprecated, and will be removed in later versions. Please use ${name} instead.`,
    );
    logger.debug(`Moving legacy environment variable ${legacyName} to ${name}`);
    process.env[name] = process.env[legacyName];
  } else if (process.env[legacyName] && process.env[name]) {
    logger.warn(
      `When searching configuration files and your environment, found ${name} but also found legacy ${legacyName}. Do you mean to be using both?`,
    );
  }

  // regardless, we've found it
  return true;
}

// Re-exported from `./dynamicLinkerEnv` so that existing callers
// (notably `src/index.ts`) keep working without edits. The logic now
// lives in a leaf module with minimal imports to avoid circular deps
// with `src/utils/system.ts` (see the file header in
// `./dynamicLinkerEnv`).
export {
  ALLOW_DYNAMIC_LINKER_ENV_VAR,
  DYNAMIC_LINKER_ENV_VARS,
  sanitizeDynamicLinkerEnv,
  sanitizeSpawnEnv,
} from './dynamicLinkerEnv';

/**
 * Warns the user if a legacy `.craft.env` file is present in the home
 * directory or the configuration file directory.
 *
 * Craft used to load environment variables from these files, but the behavior
 * was removed for security reasons: arbitrary values (including credentials)
 * could be silently injected into `process.env` based on the current working
 * directory. This helper emits a one-time warning per location pointing users
 * at their shell / CI environment for credential management.
 */
export function warnIfCraftEnvFileExists(): void {
  const candidatePaths: string[] = [];

  try {
    candidatePaths.push(join(os.homedir(), LEGACY_ENV_FILE_NAME));
  } catch {
    // os.homedir() can throw in edge cases; skip silently.
  }

  const configFileDir = getConfigFileDir();
  if (configFileDir) {
    candidatePaths.push(join(configFileDir, LEGACY_ENV_FILE_NAME));
  }

  for (const path of candidatePaths) {
    if (existsSync(path)) {
      logger.warn(
        `Found legacy "${LEGACY_ENV_FILE_NAME}" file at "${path}". ` +
          `Craft no longer reads this file for security reasons. ` +
          `Please set the required variables in your shell or CI environment instead.`,
      );
    }
  }
}

/**
 * Checks the environment for the presence of the given variable(s).
 *
 * If multiple variables are given, they are assumed to be alternates, such that
 * only one is required.
 */
export function checkEnvForPrerequisite(...varList: RequiredConfigVar[]): void {
  const varNames = varList.map(v => v.name).join(' or ');
  logger.debug('Checking for environment variable(s):', varNames);

  if (!varList.some(envHasVar)) {
    // note: Technically this function only checks the environment, not any
    // config files, but that's only because on app startup we move all config
    // variables into the environment, so we can have one central place to
    // look for them. So, when communicating with the user, we need to address
    // all of the places they might have stuck these variables.
    throw new ConfigurationError(
      `Required value(s) ${varNames} not found in configuration files or ` +
        `the environment. See the documentation for more details.`,
    );
  }
}
