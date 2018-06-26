import { existsSync, lstatSync, readFileSync } from 'fs';
import { dirname, join } from 'path';

import { safeLoad } from 'js-yaml';

// TODO support multiple configuration files (one per configuration)
const CONFIG_FILE_NAME = '.craft.yml';

interface ProjectConfig {
  github: any;
  targets: any[];
  zeus: any;
}

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
  console.log('WARNING: reached maximum allowed directory depth');
  return undefined;
}

/**
 * Return the parsed configuration file contents
 */
export function getConfiguration(): ProjectConfig {
  // TODO cache configuration for later multiple uses

  const configPath = findConfigFile();
  console.log(configPath);
  if (!configPath) {
    throw new Error('Cannot find configuration file');
  }
  return safeLoad(readFileSync(configPath, 'utf-8')) as ProjectConfig;
}
