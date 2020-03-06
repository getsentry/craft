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
  const vars = varList.map(
    item => (item instanceof String ? [item, null] : item) //
  ) as Array<[string, string]>;

  for (const [varName, legacyVarName] of vars) {
    if (!process.env[varName] && !process.env[legacyVarName]) {
      throw new ConfigurationError(
        `${varName} not found in the environment. See the documentation for more details.`
      );
    }

    // if we used to use a different name for the env variable, move it to the
    // new name and warn the user
    if (legacyVarName && process.env[legacyVarName]) {
      process.env[varName] = process.env[legacyVarName];
      logger.warn(
        `Usage of ${legacyVarName} is deprecated, and will be removed in later versions. ` +
          `Please use ${varName} instead.`
      );
    }
  }
}
