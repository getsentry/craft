import { ConfigurationError } from './errors';
import { logger } from '../logger';

/**
 * A token, key, or other value which can be stored either in an env file or
 * directly in the environment
 */
export interface RequiredConfigVar {
  name: string;
  legacyName?: string;
}
/**
 * Checks the environment for a single variable, taking into account its legacy
 * name, if app.
 *
 * Copies value over to live under current name if only found under legacy name.
 *
 * @param envVar a RequiredConfigVar object to check for
 * @returns true if variable was found, under either current or legacy name,
 * false otherwise
 */
const envHasVar = (envVar: RequiredConfigVar): boolean => {
  const { name, legacyName } = envVar;

  logger.debug(`\tChecking for environment variable ${name}`);

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
};

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
