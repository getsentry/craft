import { existsSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

import * as nvar from 'nvar';

import { CONFIG_FILE_NAME, getConfigFileDir } from '../config';
import { ConfigurationError } from './errors';
import { logger } from '../logger';

/** File name where additional environment variables are stored */
export const ENV_FILE_NAME = '.craft.env';

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

  logger.debug(`Checking for environment variable ${name}`);

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
      `Usage of ${legacyName} is deprecated, and will be removed in ` +
        `later versions. Please use ${name} instead.`
    );
    logger.debug(`Moving legacy environment variable ${legacyName} to ${name}`);
    process.env[name] = process.env[legacyName];
  } else if (process.env[legacyName] && process.env[name]) {
    logger.warn(
      `When searching configuration files and your environment, found ` +
        `${name} but also found legacy ${legacyName}. Do you mean ` +
        `to be using both?`
    );
  }

  // regardless, we've found it
  return true;
}

/**
 * Checks that the file is only readable for the owner
 *
 * It is assumed that the file already exists
 * @param path File path
 * @returns true if file is private, false otherwise
 */
function checkFileIsPrivate(path: string): boolean {
  const FULL_MODE_MASK = 0o777;
  const GROUP_MODE_MASK = 0o070;
  const OTHER_MODE_MASK = 0o007;
  const mode = statSync(path).mode;
  // tslint:disable-next-line:no-bitwise
  if (mode & GROUP_MODE_MASK || mode & OTHER_MODE_MASK) {
    // tslint:disable-next-line:no-bitwise
    const perms = (mode & FULL_MODE_MASK).toString(8);
    logger.warn(
      `Permissions 0${perms} for file "${path}" are too open. ` +
        `Consider making it readable only for the user.`
    );
    return false;
  }
  return true;
}

/**
 * Loads environment variables from ".craft.env" files in certain locations
 *
 * The following two places are checked:
 * - The user's home directory
 * - The configuration file directory
 *
 * @param overwriteExisting If set to true, overwrite the existing environment
 * variables
 */
export function readEnvironmentConfig(
  overwriteExisting: boolean = false
): void {
  let newEnv = {} as any;

  // Read from home dir
  const homedirEnvFile = join(homedir(), ENV_FILE_NAME);
  if (existsSync(homedirEnvFile)) {
    logger.debug(
      `Found environment file in the home directory: ${homedirEnvFile}`
    );
    checkFileIsPrivate(homedirEnvFile);
    const homedirEnv = {};
    nvar({ path: homedirEnvFile, target: homedirEnv });
    newEnv = { ...newEnv, ...homedirEnv };
    logger.debug(
      `Read the following variables from ${homedirEnvFile}: ${Object.keys(
        homedirEnv
      ).toString()}`
    );
  } else {
    logger.debug(
      `No environment file found in the home directory: ${homedirEnvFile}`
    );
  }

  // Read from the directory where the configuration file is located

  const configFileDir = getConfigFileDir();
  const configDirEnvFile = configFileDir && join(configFileDir, ENV_FILE_NAME);
  if (!configDirEnvFile) {
    logger.debug(`No configuration file (${CONFIG_FILE_NAME}) found!`);
  } else if (configDirEnvFile && existsSync(configDirEnvFile)) {
    logger.debug(
      `Found environment file in the configuration directory: ${configDirEnvFile}`
    );
    checkFileIsPrivate(configDirEnvFile);
    const configDirEnv = {};
    nvar({ path: configDirEnvFile, target: configDirEnv });
    newEnv = { ...newEnv, ...configDirEnv };
    logger.debug(
      `Read the following variables from ${configDirEnvFile}: ${Object.keys(
        configDirEnv
      ).toString()}`
    );
  } else {
    logger.debug(
      `No environment file found in the configuration directory: ${configDirEnvFile}`
    );
  }

  // Add non-existing values to env
  for (const key of Object.keys(newEnv)) {
    if (overwriteExisting || process.env[key] === undefined) {
      process.env[key] = newEnv[key];
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
  logger.debug(`Checking for environment variable(s) ${varNames}`);

  if (!varList.some(envHasVar)) {
    // note: Technically this function only checks the environment, not any
    // config files, but that's only because on app startup we move all config
    // variables into the environment, so we can have one central place to
    // look for them. So, when communicating with the user, we need to address
    // all of the places they might have stuck these variables.
    throw new ConfigurationError(
      `Required value(s) ${varNames} not found in configuration files or ` +
        `the environment. See the documentation for more details.`
    );
  }
}
