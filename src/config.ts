import { existsSync, lstatSync, readFileSync } from 'fs';
import { safeLoad } from 'js-yaml';
import { dirname, join } from 'path';

import logger from './logger';
import {
  CraftProjectConfig,
  GithubGlobalConfig,
} from './schemas/project_config';

// TODO support multiple configuration files (one per configuration)
const CONFIG_FILE_NAME = '.craft.yml';

/**
 * Return a full path to configuration file for the current project
 */
export function findConfigFile(): string | undefined {
  const cwd = process.cwd();
  const MAX_DEPTH = 1024;
  let depth = 0;
  let currentDir = cwd;
  while (depth <= MAX_DEPTH) {
    const probePath = join(currentDir, CONFIG_FILE_NAME);
    if (existsSync(probePath) && lstatSync(probePath).isFile()) {
      return probePath;
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
 * Return the parsed configuration file contents
 */
export function getConfiguration(): CraftProjectConfig {
  // TODO cache configuration for later multiple uses

  const configPath = findConfigFile();
  logger.debug('Configuration file found: ', configPath);
  if (!configPath) {
    throw new Error('Cannot find configuration file');
  }
  return safeLoad(readFileSync(configPath, 'utf-8')) as CraftProjectConfig;
}

/**
 * Return the parsed Github configuration, such as repository owner and name
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

  return {
    owner: repoGithubConfig.owner,
    repo: repoGithubConfig.repo,
  };
}
