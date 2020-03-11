import { ConfigurationError } from './errors';
import { logger } from '../logger';

/**
 * Checks the environment for the presence of the given variables.
 *
 * Variables can be specified either as strings or as tuples of [currentName,
 * legacyName], in which case a deprecation warning will be issued.
 */
export function checkEnvForPrerequisites(
  varList: Array<string | [string, string]>
): void {
  // ensure that every variable has a corresponding legacy name, even if it's
  // null, to make processing easier
  const vars = varList.map(item =>
    typeof item === 'string' ? [item, null] : item
  ) as Array<[string, string]>;

  for (const [varName, legacyVarName] of vars) {
    logger.debug(`Checking for environment variable ${varName}`);

    // not found, under either the current or legacy names
    if (!process.env[varName] && !process.env[legacyVarName]) {
      // note: Technically this function only checks the environment, not any
      // config files, but that's only because on app startup we move all config
      // variables into the environment, so we can have one central place to
      // look for them. So, when communicating with the user, we need to address
      // all of the places they might have stuck these variables.
      throw new ConfigurationError(
        `Required value ${varName} not found in configuration files or the ` +
          `environment. See the documentation for more details.`
      );
    }

    // if we used to use a different name for the env variable, move it to the
    // new name and warn the user
    if (legacyVarName && process.env[legacyVarName]) {
      // they're using the legacy name instead of the new name
      if (!process.env[varName]) {
        logger.warn(
          `Usage of ${legacyVarName} is deprecated, and will be removed in ` +
            `later versions. Please use ${varName} instead.`
        );
        logger.debug(
          `Moving legacy environment variable ${legacyVarName} to ${varName}`
        );
        process.env[varName] = process.env[legacyVarName];
      }

      // they have both the legacy and the new name in the environment
      else {
        logger.warn(
          `When searching configuration files and your environment, found ` +
            `${varName} but also found legacy ${legacyVarName}. Do you mean ` +
            `to be using both?`
        );
      }
      logger.info();
    } else {
      logger.debug(`Found ${varName}`);
    }
  }
}
