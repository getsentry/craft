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

/**
 * Dynamic-linker environment variables that Craft refuses to propagate.
 *
 * Setting these allows arbitrary code to be loaded into every subprocess
 * spawned by Craft (`LD_PRELOAD` on Linux, `DYLD_*` on macOS). They are a
 * well-known supply-chain attack vector: an attacker who can influence
 * Craft's environment (e.g. via a dotfile, a previous build step, or a
 * misconfigured CI secret) can silently execute code with access to every
 * release credential Craft touches. We strip these at startup as
 * defence-in-depth — legitimate uses are extremely rare and can be
 * re-enabled per-invocation via `CRAFT_ALLOW_DYNAMIC_LINKER_ENV=1`.
 */
const DYNAMIC_LINKER_ENV_VARS = [
  // Linux / glibc / musl
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'LD_AUDIT',
  // macOS dyld
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',
  'DYLD_FRAMEWORK_PATH',
  'DYLD_FALLBACK_LIBRARY_PATH',
  'DYLD_FALLBACK_FRAMEWORK_PATH',
] as const;

/** Opt-out env var for {@link sanitizeDynamicLinkerEnv}. */
const ALLOW_DYNAMIC_LINKER_ENV_VAR = 'CRAFT_ALLOW_DYNAMIC_LINKER_ENV';

/**
 * Strips dynamic-linker environment variables (`LD_PRELOAD`, `LD_LIBRARY_PATH`,
 * `DYLD_*`, etc.) from `process.env` at startup, logging a warning for each
 * stripped key. Values are never logged.
 *
 * Users who legitimately require these variables (e.g. for an instrumented
 * build toolchain) can set `CRAFT_ALLOW_DYNAMIC_LINKER_ENV=1` to opt out;
 * this is noisy by design to make the escape hatch visible in CI logs.
 */
export function sanitizeDynamicLinkerEnv(): void {
  const allowOverride = process.env[ALLOW_DYNAMIC_LINKER_ENV_VAR] === '1';
  const presentKeys = DYNAMIC_LINKER_ENV_VARS.filter(
    key => process.env[key] !== undefined,
  );

  if (presentKeys.length === 0) {
    return;
  }

  if (allowOverride) {
    logger.info(
      `${ALLOW_DYNAMIC_LINKER_ENV_VAR}=1 set; preserving dynamic-linker environment variables: ${presentKeys.join(
        ', ',
      )}. This is not recommended.`,
    );
    return;
  }

  for (const key of presentKeys) {
    logger.warn(
      `Stripping dynamic-linker environment variable "${key}" for security reasons. ` +
        `Set ${ALLOW_DYNAMIC_LINKER_ENV_VAR}=1 to override (not recommended).`,
    );
    delete process.env[key];
  }
}

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
