import { existsSync, lstatSync, readFileSync } from 'fs';
import path from 'path';

import { load } from 'js-yaml';
import GitUrlParse from 'git-url-parse';
import { createGitClient } from './utils/git';
import { ZodError } from 'zod';

import { logger } from './logger';
import {
  CraftProjectConfig,
  CraftProjectConfigSchema,
  GitHubGlobalConfig,
  ArtifactProviderName,
  StatusProviderName,
  TargetConfig,
  ChangelogPolicy,
  VersioningPolicy,
} from './schemas/project_config';
import { ConfigurationError } from './utils/errors';
import { isCompiledGitHubAction } from './utils/detection';
import {
  getPackageVersion,
  parseVersion,
  versionGreaterOrEqualThan,
} from './utils/version';
// Note: We import getTargetByName lazily in expandWorkspaceTargets to avoid
// circular dependency: config -> targets -> registry -> utils/registry -> symlink -> version -> config
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
      `Cannot find Craft configuration file. Have you added "${CONFIG_FILE_NAME}" to your project?`,
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
 * Parses and validate passed configuration object
 *
 * Throw an error is the object cannot be properly parsed as configuration.
 *
 * @param rawConfig Raw project configuration object
 */
export function validateConfiguration(
  rawConfig: Record<string, any>,
): CraftProjectConfig {
  logger.debug('Parsing and validating the configuration file...');
  try {
    return CraftProjectConfigSchema.parse(rawConfig);
  } catch (error) {
    if (error instanceof ZodError) {
      const messages = error.errors
        .map(e => `${e.path.join('.')}: ${e.message}`)
        .join('\n');
      throw new ConfigurationError(
        `Cannot parse configuration file:\n${messages}`,
      );
    }
    throw error;
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
 * Loads and caches configuration from a YAML string.
 *
 * This is used by --config-from to load config from a remote branch.
 *
 * @param configContent The raw YAML configuration content
 */
export function loadConfigurationFromString(
  configContent: string,
): CraftProjectConfig {
  logger.debug('Loading configuration from provided content...');
  const rawConfig = load(configContent) as Record<string, any>;
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
      'No minimal version specified in the configuration, skpipping the check',
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
      `"craft" version is compatible with the minimal version from the configuration file.`,
    );
  } else {
    throw new ConfigurationError(
      `Incompatible "craft" versions. Current version: ${currentVersionRaw},  minimal version: ${minVersionRaw} (taken from .craft.yml).`,
    );
  }
}

/**
 * Checks if the project's minVersion configuration meets a required minimum.
 *
 * This is used to gate features that require a certain version of craft.
 * For example, auto-versioning requires minVersion >= 2.14.0.
 *
 * @param requiredVersion The minimum version required for the feature
 * @returns true if the project's minVersion is >= requiredVersion, false otherwise
 */
export function requiresMinVersion(requiredVersion: string): boolean {
  const config = getConfiguration();
  const minVersionRaw = config.minVersion;

  if (!minVersionRaw) {
    // If no minVersion is configured, the feature is not available
    return false;
  }

  const configuredMinVersion = parseVersion(minVersionRaw);
  const required = parseVersion(requiredVersion);

  if (!configuredMinVersion || !required) {
    return false;
  }

  return versionGreaterOrEqualThan(configuredMinVersion, required);
}

/** Minimum craft version required for auto-versioning and CalVer */
const AUTO_VERSION_MIN_VERSION = '2.14.0';

/**
 * Returns the effective versioning policy for the project.
 *
 * The policy determines how versions are resolved when no explicit version
 * is provided to `craft prepare`:
 * - 'auto': Analyze commits to determine the bump type
 * - 'manual': Require an explicit version argument
 * - 'calver': Use calendar versioning
 *
 * If not explicitly configured, defaults to:
 * - 'auto' if minVersion >= 2.14.0
 * - 'manual' otherwise (for backward compatibility)
 *
 * @returns The versioning policy
 */
export function getVersioningPolicy(): VersioningPolicy {
  const config = getConfiguration();

  // Use explicitly configured policy if available
  if (config.versioning?.policy) {
    return config.versioning.policy;
  }

  // Default based on minVersion
  return requiresMinVersion(AUTO_VERSION_MIN_VERSION)
    ? VersioningPolicy.Auto
    : VersioningPolicy.Manual;
}

/**
 * Return the parsed global GitHub configuration
 */
let _globalGitHubConfigCache: GitHubGlobalConfig | null;
export async function getGlobalGitHubConfig(
  clearCache = false,
): Promise<GitHubGlobalConfig> {
  if (!clearCache && _globalGitHubConfigCache !== undefined) {
    if (_globalGitHubConfigCache === null) {
      throw new ConfigurationError(
        'GitHub configuration not found in the config file and cannot be determined from Git',
      );
    }

    return _globalGitHubConfigCache;
  }

  // We extract global GitHub configuration (owner/repo) from top-level
  // configuration
  let repoGitHubConfig = getConfiguration(clearCache).github || null;

  if (!repoGitHubConfig) {
    const configDir = getConfigFileDir() || '.';
    const git = createGitClient(configDir);
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
      'The "changelogPolicy" option is deprecated. Please use "changelog.policy" instead.',
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

/**
 * Result of noMerge configuration resolution
 */
export interface NoMergeConfig {
  /** Whether to skip merging the release branch */
  noMerge: boolean;
  /** The source of the noMerge value */
  source: 'config' | 'auto-detected' | 'default';
}

/**
 * Returns whether the release branch should be merged after publishing.
 *
 * Resolution order:
 * 1. Explicit `noMerge` value in .craft.yml takes precedence
 * 2. Auto-detect compiled GitHub Actions (Node.js actions with dist/ folder)
 * 3. Default to false (merge the branch)
 *
 * Compiled GitHub Actions typically have their `dist/` folder gitignored on
 * main/master but need it in release branches for the action to work. Merging
 * the release branch back would overwrite the clean main branch with compiled
 * artifacts.
 *
 * @returns Configuration object with noMerge value and its source
 */
export function getNoMergeConfig(): NoMergeConfig {
  const config = getConfiguration();

  // Explicit config takes precedence
  if (config.noMerge !== undefined) {
    return {
      noMerge: config.noMerge,
      source: 'config',
    };
  }

  // Auto-detect compiled GitHub Action
  const rootDir = getConfigFileDir() || process.cwd();
  if (isCompiledGitHubAction(rootDir)) {
    logger.debug(
      'Detected compiled GitHub Action (Node.js action with dist/ folder), defaulting noMerge to true',
    );
    return {
      noMerge: true,
      source: 'auto-detected',
    };
  }

  // Default: merge the branch
  return {
    noMerge: false,
    source: 'default',
  };
}

/**
 * Type for target classes that support expansion
 */
interface ExpandableTargetClass {
  expand(config: TargetConfig, rootDir: string): Promise<TargetConfig[]>;
}

/**
 * Check if a target class has an expand method
 */
function isExpandableTarget(
  targetClass: unknown,
): targetClass is ExpandableTargetClass {
  return (
    typeof targetClass === 'function' &&
    'expand' in targetClass &&
    typeof targetClass.expand === 'function'
  );
}

/**
 * Expand all expandable targets in the target list
 *
 * This function takes a list of target configs and expands any targets
 * whose target class has an `expand` static method. This allows targets
 * to implement their own expansion logic (e.g., npm workspace expansion).
 *
 * @param targets The original list of target configs
 * @returns The expanded list of target configs
 */
export async function expandWorkspaceTargets(
  targets: TargetConfig[],
): Promise<TargetConfig[]> {
  // Lazy import to avoid circular dependency

  const { getTargetByName } = require('./targets');

  const rootDir = getConfigFileDir() || process.cwd();
  const expandedTargets: TargetConfig[] = [];

  for (const target of targets) {
    const targetClass = getTargetByName(target.name);

    if (targetClass && isExpandableTarget(targetClass)) {
      const expanded = await targetClass.expand(target, rootDir);
      expandedTargets.push(...expanded);
    } else {
      expandedTargets.push(target);
    }
  }

  return expandedTargets;
}
