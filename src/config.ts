import { existsSync, lstatSync, readFileSync } from 'fs';
import path from 'path';

import ajv from 'ajv';
import { safeLoad } from 'js-yaml';
import GitUrlParse from 'git-url-parse';
import simpleGit from 'simple-git';

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
import { GithubArtifactProvider } from './artifact_providers/github';
import { ZeusArtifactProvider } from './artifact_providers/zeus';
import { NoneArtifactProvider } from './artifact_providers/none';
import { GCSArtifactProvider } from './artifact_providers/gcs';

import { ZeusStatusProvider } from './status_providers/zeus';
import { GithubStatusProvider } from './status_providers/github';
import {
  BaseStatusProvider,
  StatusProviderConfig,
} from './status_providers/base';

// TODO support multiple configuration files (one per configuration)
export const CONFIG_FILE_NAME = '.craft.yml';

/**
 * The default prefix for the release branch.
 */
export const DEFAULT_RELEASE_BRANCH_NAME = 'release';

/**
 * Epoch version for changing all defaults to GitHub
 */
export const DEFAULTS_EPOCH_VERSION = '0.21.0';

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
    const probePath = path.join(currentDir, CONFIG_FILE_NAME);
    if (existsSync(probePath) && lstatSync(probePath).isFile()) {
      _configPathCache = probePath;
      return _configPathCache;
    }
    const parentDir = path.dirname(currentDir);
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
  return path.dirname(configFilePath);
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
export function validateConfiguration(
  rawConfig: Record<string, any>
): CraftProjectConfig {
  logger.debug('Parsing and validating the configuration file...');
  const schemaName = 'projectConfig';
  const projectConfigSchema = getProjectConfigSchema();
  const ajvValidator = new ajv().addSchema(projectConfigSchema, schemaName);
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
export function getConfiguration(clearCache = false): CraftProjectConfig {
  if (!clearCache && _configCache) {
    return _configCache;
  }

  const configPath = getConfigFilePath();
  logger.debug('Configuration file found: ', configPath);
  const rawConfig = safeLoad(readFileSync(configPath, 'utf-8')) as Record<
    string,
    any
  >;
  _configCache = validateConfiguration(rawConfig);
  checkMinimalConfigVersion(_configCache);
  return _configCache;
}

/**
 * Checks that the current "craft" version is compatible with the configuration
 *
 * "minVersion" configuration parameter specifies the minimal version of "craft"
 * that can work with the given configuration.
 */
function checkMinimalConfigVersion(config: CraftProjectConfig): void {
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
    logger.debug(
      `"craft" version is compatible with the minimal version from the configuration file.`
    );
  } else {
    throw new ConfigurationError(
      `Incompatible "craft" versions. Current version: ${currentVersionRaw},  minimal version: ${minVersionRaw} (taken from .craft.yml).`
    );
  }
}

export function isAfterEpoch(): boolean {
  const config = getConfiguration();
  const minVersionRaw = config.minVersion;
  if (!minVersionRaw) {
    return false;
  }

  const minVersion = parseVersion(minVersionRaw);
  if (!minVersion) {
    throw new Error(`Cannot parse the minimal version: "${minVersionRaw}"`);
  }

  const epochVersion = parseVersion(DEFAULTS_EPOCH_VERSION);
  if (!epochVersion) {
    throw new Error(
      `Cannot parse the current version: "${DEFAULTS_EPOCH_VERSION}"`
    );
  }

  return versionGreaterOrEqualThan(minVersion, epochVersion);
}

/**
 * Return the parsed global Github configuration
 */
let _globalGithubConfigCache: GithubGlobalConfig | null;
export async function getGlobalGithubConfig(
  clearCache = false
): Promise<GithubGlobalConfig> {
  if (!clearCache && _globalGithubConfigCache !== undefined) {
    if (_globalGithubConfigCache === null) {
      throw new ConfigurationError(
        'GitHub configuration not found in the config file and cannot be determined from Git'
      );
    }

    return _globalGithubConfigCache;
  }

  // We extract global Github configuration (owner/repo) from top-level
  // configuration
  let repoGithubConfig = getConfiguration(clearCache).github || null;

  if (!repoGithubConfig) {
    const configDir = getConfigFileDir() || '.';
    const git = simpleGit(configDir);
    let remoteUrl;
    try {
      const remotes = await git.getRemotes(true);
      const defaultRemote =
        remotes.find(remote => remote.name === 'origin') || remotes[0];
      remoteUrl =
        defaultRemote &&
        GitUrlParse(defaultRemote.refs.push || defaultRemote.refs.fetch);
    } catch (error) {
      logger.warn('Error when trying to get git remotes: ', error);
    }

    if (remoteUrl?.source === 'github.com') {
      repoGithubConfig = {
        owner: remoteUrl.owner,
        repo: remoteUrl.name,
      };
    }
  }

  _globalGithubConfigCache = Object.freeze(repoGithubConfig);

  return getGlobalGithubConfig();
}

/**
 * Gets git tag prefix from configuration
 */
export function getGitTagPrefix(): string {
  const targets = getConfiguration().targets || [];
  const githubTarget = targets.find(target => target.name === 'github');
  return githubTarget?.tagPrefix || '';
}

/**
 * Create an artifact provider instance from the spec in the configuration file
 *
 * @returns An instance of artifact provider (which may be the dummy
 * NoneArtifactProvider if artifact storage is disabled).
 */
export async function getArtifactProviderFromConfig(): Promise<BaseArtifactProvider> {
  const projectConfig = getConfiguration();

  let artifactProviderName = projectConfig.artifactProvider?.name;
  if (artifactProviderName == null) {
    if (isAfterEpoch()) {
      artifactProviderName = ArtifactProviderName.Github;
    } else {
      logger.warn(
        `You are relying on the default artifact provider, which has changed Craft v${DEFAULTS_EPOCH_VERSION}.`
      );
      logger.warn(
        `This will affect you when you set your \`minVersion\` in your config to ${DEFAULTS_EPOCH_VERSION} or later.`
      );
      artifactProviderName = ArtifactProviderName.Zeus;
    }
  }

  const githubRepo = await getGlobalGithubConfig();
  const artifactProviderConfig = {
    name: artifactProviderName,
    ...projectConfig.artifactProvider?.config,
    repoName: githubRepo.repo,
    repoOwner: githubRepo.owner,
  };

  logger.debug(`Using "${artifactProviderName}" for artifacts`);
  switch (artifactProviderName) {
    case ArtifactProviderName.Zeus:
      return new ZeusArtifactProvider(artifactProviderConfig);
    case ArtifactProviderName.None:
      return new NoneArtifactProvider();
    case ArtifactProviderName.GCS:
      return new GCSArtifactProvider(artifactProviderConfig);
    case ArtifactProviderName.Github:
      return new GithubArtifactProvider(artifactProviderConfig);
    default: {
      throw new ConfigurationError('Invalid artifact provider');
    }
  }
}

/**
 * Create a status provider instance from the spec in the configuration file
 *
 * @returns An instance of status provider
 */
export async function getStatusProviderFromConfig(): Promise<BaseStatusProvider> {
  const config = getConfiguration();
  const githubConfig = await getGlobalGithubConfig();

  const rawStatusProvider = config.statusProvider || {
    config: undefined,
    name: undefined,
  };

  let statusProviderName = rawStatusProvider.name;
  if (statusProviderName == null) {
    if (isAfterEpoch()) {
      statusProviderName = StatusProviderName.Github;
    } else {
      logger.warn(
        `You are relying on the default status provider, which has changed Craft v${DEFAULTS_EPOCH_VERSION}.`
      );
      logger.warn(
        `This will affect you when you set your \`minVersion\` in your config to ${DEFAULTS_EPOCH_VERSION} or later.`
      );
      statusProviderName = StatusProviderName.Zeus;
    }
  }

  const statusProviderConfig: StatusProviderConfig = {
    ...rawStatusProvider.config,
    name: statusProviderName,
  };

  logger.debug(`Using "${statusProviderName}" for status checks`);
  switch (statusProviderName) {
    case StatusProviderName.Zeus:
      return new ZeusStatusProvider(statusProviderConfig, githubConfig);
    case StatusProviderName.Github:
      return new GithubStatusProvider(statusProviderConfig, githubConfig);
    default: {
      throw new ConfigurationError('Invalid status provider');
    }
  }
}
