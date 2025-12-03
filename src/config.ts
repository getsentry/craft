import { existsSync, lstatSync, readFileSync } from 'fs';
import path from 'path';

import ajv from 'ajv';
import { load } from 'js-yaml';
import GitUrlParse from 'git-url-parse';
import simpleGit from 'simple-git';

import { logger } from './logger';
import {
  CraftProjectConfig,
  GitHubGlobalConfig,
  ArtifactProviderName,
  StatusProviderName,
  ChangelogPolicy,
} from './schemas/project_config';
import { ConfigurationError } from './utils/errors';
import {
  getPackageVersion,
  parseVersion,
  versionGreaterOrEqualThan,
} from './utils/version';
import { BaseArtifactProvider } from './artifact_providers/base';
import { GitHubArtifactProvider } from './artifact_providers/github';
import { NoneArtifactProvider } from './artifact_providers/none';
import { GCSArtifactProvider } from './artifact_providers/gcs';

import { GitHubStatusProvider } from './status_providers/github';
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
  const rawConfig = load(readFileSync(configPath, 'utf-8')) as Record<
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

/**
 * Return the parsed global GitHub configuration
 */
let _globalGitHubConfigCache: GitHubGlobalConfig | null;
export async function getGlobalGitHubConfig(
  clearCache = false
): Promise<GitHubGlobalConfig> {
  if (!clearCache && _globalGitHubConfigCache !== undefined) {
    if (_globalGitHubConfigCache === null) {
      throw new ConfigurationError(
        'GitHub configuration not found in the config file and cannot be determined from Git'
      );
    }

    return _globalGitHubConfigCache;
  }

  // We extract global GitHub configuration (owner/repo) from top-level
  // configuration
  let repoGitHubConfig = getConfiguration(clearCache).github || null;

  if (!repoGitHubConfig) {
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
      repoGitHubConfig = {
        owner: remoteUrl.owner,
        repo: remoteUrl.name,
      };
    }
  }

  _globalGitHubConfigCache = Object.freeze(repoGitHubConfig);

  return getGlobalGitHubConfig();
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
    artifactProviderName = ArtifactProviderName.GitHub;
  }

  const githubRepo = await getGlobalGitHubConfig();
  const artifactProviderConfig = {
    name: artifactProviderName,
    ...projectConfig.artifactProvider?.config,
    repoName: githubRepo.repo,
    repoOwner: githubRepo.owner,
  };

  logger.debug(`Using "${artifactProviderName}" for artifacts`);
  switch (artifactProviderName) {
    case ArtifactProviderName.None:
      return new NoneArtifactProvider();
    case ArtifactProviderName.GCS:
      return new GCSArtifactProvider(artifactProviderConfig);
    case ArtifactProviderName.GitHub:
      return new GitHubArtifactProvider(artifactProviderConfig);
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
  const githubConfig = await getGlobalGitHubConfig();

  const rawStatusProvider = config.statusProvider || {
    config: undefined,
    name: undefined,
  };

  let statusProviderName = rawStatusProvider.name;
  if (statusProviderName == null) {
    statusProviderName = StatusProviderName.GitHub;
  }

  const statusProviderConfig: StatusProviderConfig = {
    ...rawStatusProvider.config,
    name: statusProviderName,
  };

  logger.debug(`Using "${statusProviderName}" for status checks`);
  switch (statusProviderName) {
    case StatusProviderName.GitHub:
      return new GitHubStatusProvider(statusProviderConfig, githubConfig);
    default: {
      throw new ConfigurationError('Invalid status provider');
    }
  }
}

/**
 * Normalized changelog configuration with all fields resolved
 */
export interface NormalizedChangelogConfig {
  /** Path to the changelog file */
  filePath: string;
  /** Changelog management policy */
  policy: ChangelogPolicy;
  /** Whether to group entries by conventional commit scope */
  scopeGrouping: boolean;
}

const DEFAULT_CHANGELOG_FILE_PATH = 'CHANGELOG.md';

/**
 * Returns the normalized changelog configuration from .craft.yml
 *
 * Handles both legacy `changelogPolicy` and new `changelog` object format.
 * Emits deprecation warning when using `changelogPolicy`.
 */
export function getChangelogConfig(): NormalizedChangelogConfig {
  const config = getConfiguration();

  // Default values
  let filePath = DEFAULT_CHANGELOG_FILE_PATH;
  let policy = ChangelogPolicy.None;
  let scopeGrouping = true;

  // Handle legacy changelogPolicy (deprecated)
  if (config.changelogPolicy !== undefined) {
    logger.warn(
      'The "changelogPolicy" option is deprecated. Please use "changelog.policy" instead.'
    );
    policy = config.changelogPolicy;
  }

  // Handle changelog config
  if (config.changelog !== undefined) {
    if (typeof config.changelog === 'string') {
      // Legacy string format - just the file path
      filePath = config.changelog;
    } else {
      // New object format
      if (config.changelog.filePath !== undefined) {
        filePath = config.changelog.filePath;
      }
      if (config.changelog.policy !== undefined) {
        policy = config.changelog.policy as ChangelogPolicy;
      }
      if (config.changelog.scopeGrouping !== undefined) {
        scopeGrouping = config.changelog.scopeGrouping;
      }
    }
  }

  return {
    filePath,
    policy,
    scopeGrouping,
  };
}
