import * as Ajv from 'ajv';
import { existsSync, lstatSync, readFileSync } from 'fs';
import { safeLoad } from 'js-yaml';
import { dirname, join } from 'path';

import logger from './logger';
import {
  CraftProjectConfig,
  GithubGlobalConfig,
} from './schemas/project_config';

// TODO support multiple configuration files (one per configuration)
export const CONFIG_FILE_NAME = '.craft.yml';

/**
 * Cached configuration is stored here
 */
let _configCache: CraftProjectConfig;

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
 * Read JSON schema for project configuration
 */
export function getProjectConfigSchema(): any {
  return require('./schemas/project_config.schema');
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
