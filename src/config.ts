import { existsSync, lstatSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';

import * as Ajv from 'ajv';
import { safeLoad } from 'js-yaml';
import * as nvar from 'nvar';

import { logger } from './logger';
import {
  CraftProjectConfig,
  GithubGlobalConfig,
} from './schemas/project_config';
import { parseVersion, versionGreaterOrEqualThan } from './utils/version';

// TODO support multiple configuration files (one per configuration)
export const CONFIG_FILE_NAME = '.craft.yml';

/** File name where additional environment variables are stored */
export const ENV_FILE_NAME = '.craft.env';

/**
 * Cached path to the configuration file
 */
let _configPathCache: string;

/**
 * Cached configuration
 */
let _configCache: CraftProjectConfig;

/**
 * Return a full path to configuration file for the current project
 */
export function findConfigFile(): string | undefined {
  if (_configPathCache) {
    return _configPathCache;
  }

  const cwd = process.cwd();
  const MAX_DEPTH = 1024;
  let depth = 0;
  let currentDir = cwd;
  while (depth <= MAX_DEPTH) {
    const probePath = join(currentDir, CONFIG_FILE_NAME);
    if (existsSync(probePath) && lstatSync(probePath).isFile()) {
      _configPathCache = probePath;
      return _configPathCache;
    }
    const parentDir = dirname(currentDir);
    if (currentDir === parentDir) {
      // Reached root directory
      return undefined;
    }
    currentDir = parentDir;
    depth += 1;
  }
  logger.warn('findConfigFile: Reached maximum allowed directory depth');
  return undefined;
}

/**
 * Read JSON schema for project configuration
 */
export function getProjectConfigSchema(): any {
  return require('./schemas/projectConfig.schema');
}

/**
 * Parse and validate passed configuration object
 *
 * Throw an error is the object cannot be properly parsed as configuration.
 *
 * @param rawConfig Raw project configuration object
 */
export function validateConfiguration(rawConfig: any): CraftProjectConfig {
  logger.debug('Parsing and validating the configuration file...');
  const schemaName = 'projectConfig';
  const projectConfigSchema = getProjectConfigSchema();
  const ajvValidator = new Ajv().addSchema(projectConfigSchema, schemaName);
  const valid = ajvValidator.validate(schemaName, rawConfig);
  if (valid) {
    return rawConfig as CraftProjectConfig;
  } else {
    throw new Error(
      `Cannot parse configuration file:\n${ajvValidator.errorsText()}`
    );
  }
}

/**
 * Return the parsed configuration file contents
 */
export function getConfiguration(): CraftProjectConfig {
  if (_configCache) {
    return _configCache;
  }

  const configPath = findConfigFile();
  if (!configPath) {
    throw new Error(
      `Cannot find Craft configuration file. Have you added "${CONFIG_FILE_NAME}" to your project?`
    );
  }
  logger.debug('Configuration file found: ', configPath);
  const rawConfig = safeLoad(readFileSync(configPath, 'utf-8'));
  _configCache = validateConfiguration(rawConfig);
  return _configCache;
}

/**
 * Checks that the current "craft" version is compatible with the configuration
 *
 * "minVersion" configuration parameter specifies the minimal version of "craft"
 * that can work with the given configuration.
 */
export function checkMinimalConfigVersion(): void {
  const config = getConfiguration();
  const minVersionRaw = config.minVersion;
  if (!minVersionRaw) {
    logger.debug(
      'No minimal version specified in the configuration, skpipping the check'
    );
    return;
  }

  const currentVersionRaw = require('../package.json').version;
  if (!currentVersionRaw) {
    throw new Error('Cannot get the current craft version');
  }

  const minVersion = parseVersion(minVersionRaw);
  if (!minVersion) {
    throw new Error(`Cannot parse the minimal version: "${minVersionRaw}"`);
  }
  const currentVersion = parseVersion(currentVersionRaw);
  if (!currentVersion) {
    throw new Error(`Cannot parse the current version: "${currentVersionRaw}"`);
  }

  if (versionGreaterOrEqualThan(currentVersion, minVersion)) {
    logger.info(
      `"craft" version is compatible with the minimal version from the configuration file.`
    );
  } else {
    throw new Error(
      `Incompatible "craft" versions. Current version: ${currentVersionRaw},  minimal version: ${minVersionRaw} (taken from .craft.yml).`
    );
  }
}

/**
 * Return the parsed global Github configuration
 */
export function getGlobalGithubConfig(): GithubGlobalConfig {
  // We extract global Github configuration (owner/repo) from top-level
  // configuration
  const repoGithubConfig = getConfiguration().github || {};

  if (!repoGithubConfig) {
    throw new Error('GitHub configuration not found in the config file');
  }

  if (!repoGithubConfig.owner) {
    throw new Error('GitHub target: owner not found');
  }

  if (!repoGithubConfig.repo) {
    throw new Error('GitHub target: repo not found');
  }

  return repoGithubConfig;
}

/**
 * Gets git tag prefix from configuration
 */
export function getGitTagPrefix(): string {
  const targets = getConfiguration().targets || [];
  const githubTarget = targets.find(target => target.name === 'github') || {};
  return githubTarget.tagPrefix || '';
}

/**
 * Loads environment variables from ".craft.env" files in certain locations
 *
 * The following two places are checked:
 * - The user's home directory
 * - The current working directory
 *
 * @param overwriteExisting If set to true, overwrite the existing environment variables
 */
export function readEnvironmentConfig(
  overwriteExisting: boolean = false
): void {
  let newEnv = {} as any;

  // Read from home dir
  const homedirEnvFile = join(homedir(), ENV_FILE_NAME);
  if (existsSync(homedirEnvFile)) {
    logger.info(
      `Found environment file in the home directory: ${homedirEnvFile}`
    );
    const homedirEnv = {};
    nvar({ path: homedirEnvFile, target: homedirEnv });
    newEnv = { ...newEnv, ...homedirEnv };
    logger.debug(
      `Read the following variables from ${homedirEnvFile}: ${Object.keys(
        homedirEnv
      )}`
    );
  } else {
    logger.debug(
      `No environment file found in the home directory: ${homedirEnvFile}`
    );
  }

  // Read from current dir
  const currentDirEnvFile = join(process.cwd(), ENV_FILE_NAME);
  if (existsSync(currentDirEnvFile)) {
    logger.info(
      `Found environment file in the current directory: ${currentDirEnvFile}`
    );
    const currentDirEnv = {};
    nvar({ path: currentDirEnvFile, target: currentDirEnv });
    newEnv = { ...newEnv, ...currentDirEnv };
    logger.debug(
      `Read the following variables from ${currentDirEnvFile}: ${Object.keys(
        currentDirEnv
      )}`
    );
  } else {
    logger.debug(
      `No environment file found in the current directory: ${currentDirEnvFile}`
    );
  }

  // Add non-existing values to env
  for (const key of Object.keys(newEnv)) {
    if (overwriteExisting || process.env[key] === undefined) {
      process.env[key] = newEnv[key];
    }
  }
}
