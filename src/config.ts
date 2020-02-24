import { existsSync, lstatSync, readFileSync, statSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';

import * as Ajv from 'ajv';
import { safeLoad } from 'js-yaml';
import * as nvar from 'nvar';

import { logger } from './logger';
import {
  CraftProjectConfig,
  GithubGlobalConfig,
  ArtifactProviderName,
  StatusProviderName,
} from './schemas/project_config';
import { ConfigurationError } from './utils/errors';
import {
  getPackageVersion,
  parseVersion,
  versionGreaterOrEqualThan,
} from './utils/version';
import { BaseArtifactProvider } from './artifact_providers/base';
import { ZeusArtifactProvider } from './artifact_providers/zeus';
import { ZeusStatusProvider } from './status_providers/zeus';
import { GithubStatusProvider } from './status_providers/github';
import { BaseStatusProvider } from './status_providers/base';
import { NoneArtifactProvider } from './artifact_providers/none';

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
 * Searches the current and parent directories for the configuration file
 *
 * Returns "undefined" if no file was found.
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
 * Returns project configuration (.craft.yml) file path
 *
 * Throws an error if the file cannot be found.
 */
export function getConfigFilePath(): string {
  const configFilePath = findConfigFile();
  if (!configFilePath) {
    throw new ConfigurationError(
      `Cannot find Craft configuration file. Have you added "${CONFIG_FILE_NAME}" to your project?`
    );
  }
  return configFilePath;
}

/**
 * Returns the path to the directory that contains the configuration file
 *
 * Returns "undefined" if no configuration file can be found.
 */
export function getConfigFileDir(): string | undefined {
  const configFilePath = findConfigFile();
  if (!configFilePath) {
    return undefined;
  }
  return dirname(configFilePath);
}

/**
 * Reads JSON schema for project configuration
 */
export function getProjectConfigSchema(): any {
  return require('./schemas/projectConfig.schema');
}

/**
 * Parses and validate passed configuration object
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
    throw new ConfigurationError(
      `Cannot parse configuration file:\n${ajvValidator.errorsText()}`
    );
  }
}

/**
 * Returns the parsed configuration file contents
 */
export function getConfiguration(): CraftProjectConfig {
  if (_configCache) {
    return _configCache;
  }

  const configPath = getConfigFilePath();
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

  const currentVersionRaw = getPackageVersion();
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
    throw new ConfigurationError(
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
    throw new ConfigurationError(
      'GitHub configuration not found in the config file'
    );
  }

  if (!repoGithubConfig.owner) {
    throw new ConfigurationError('GitHub target: owner not found');
  }

  if (!repoGithubConfig.repo) {
    throw new ConfigurationError('GitHub target: repo not found');
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
 * Checks that the file is only readable for the owner
 *
 * It is assumed that the file already exists
 * @param path File path
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
      `Permissions 0${perms} for file "${path}" are too open. Consider making it readable only for the user.\n`
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
 * @param overwriteExisting If set to true, overwrite the existing environment variables
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

  // Apparently this is the best we can do to make getConfigFileDir mockable ;(
  // See https://github.com/facebook/jest/issues/936 for more info
  const configFileDir = exports.getConfigFileDir() as string | undefined;
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
 * Create an artifact provider instance from the spec in the configuration file
 *
 * @returns An instance of artifact provider, or "undefined" if the artifact
 * provider is disabled.
 */
export function getArtifactProviderFromConfig(): BaseArtifactProvider {
  const config = getConfiguration() || {};
  const githubConfig = config.github;

  const rawStatusProvider = config.artifactProvider || {
    config: undefined,
    name: undefined,
  };
  const statusProviderName = rawStatusProvider.name;

  switch (statusProviderName) {
    case undefined: // Zeus is the default at the moment
    case ArtifactProviderName.Zeus:
      return new ZeusArtifactProvider(githubConfig.owner, githubConfig.repo);
    case ArtifactProviderName.None:
      return new NoneArtifactProvider();
    default: {
      throw new ConfigurationError('Invalid artifact provider');
    }
  }
}

/**
 * Create a status provider instance from the spec in the configuration file
 *
 * @returns An instance of artifact provider
 */
export function getStatusProviderFromConfig(): BaseStatusProvider {
  const config = getConfiguration() || {};
  const githubConfig = config.github;

  const rawStatusProvider = config.statusProvider || {
    config: undefined,
    name: undefined,
  };
  const {
    config: statusProviderConfig,
    name: statusProviderName,
  } = rawStatusProvider;

  switch (statusProviderName) {
    case undefined:
    case StatusProviderName.Zeus:
      return new ZeusStatusProvider(
        githubConfig.owner,
        githubConfig.repo,
        statusProviderConfig
      );
    case StatusProviderName.Github:
      return new GithubStatusProvider(
        githubConfig.owner,
        githubConfig.repo,
        statusProviderConfig
      );
    default: {
      throw new ConfigurationError('Invalid status provider');
    }
  }
}
