import * as Github from '@octokit/rest';
import * as fs from 'fs';
import { basename, join } from 'path';
import { promisify } from 'util';

import { getGlobalGithubConfig } from '../config';
import { logger as loggerRaw } from '../logger';
import { GithubGlobalConfig, TargetConfig } from '../schemas/project_config';
import { ZeusStore } from '../stores/zeus';
import { ConfigurationError, reportError } from '../utils/errors';
import { withTempDir } from '../utils/files';
import { getFile, getGithubClient } from '../utils/githubApi';
import { checkExecutableIsPresent, spawnProcess } from '../utils/system';
import { BaseTarget } from './base';
const writeFile = promisify(fs.writeFile);

const logger = loggerRaw.withScope('[cocoapods]');

const DEFAULT_COCOAPODS_BIN = 'pod';

/**
 * Command to launch cocoapods
 */
const COCOAPODS_BIN = process.env.COCOAPODS_BIN || DEFAULT_COCOAPODS_BIN;

/** Options for "cocoapods" target */
export interface CocoapodsTargetOptions extends TargetConfig {
  /** Cocoapods trunk (API) token */
  trunkToken: string;
  /** Path to the spec file inside the repo */
  specPath: string;
}

/**
 * Target responsible for publishing to Cocoapods registry
 */
export class CocoapodsTarget extends BaseTarget {
  /** Target name */
  public readonly name: string = 'cocoapods';
  /** Target options */
  public readonly cocoapodsConfig: CocoapodsTargetOptions;
  /** Github client */
  public readonly github: Github;
  /** Github repo configuration */
  public readonly githubRepo: GithubGlobalConfig;

  public constructor(config: any, store: ZeusStore) {
    super(config, store);
    this.cocoapodsConfig = this.getCocoapodsConfig();
    this.github = getGithubClient();
    this.githubRepo = getGlobalGithubConfig();
    checkExecutableIsPresent(COCOAPODS_BIN);
  }

  /**
   * Extracts Cocoapods target options from the environment
   */
  public getCocoapodsConfig(): CocoapodsTargetOptions {
    if (!process.env.COCOAPODS_TRUNK_TOKEN) {
      throw new ConfigurationError(
        `Cannot perform Cocoapod release: missing credentials.
         Please fill COCOAPODS_TRUNK_TOKEN environment variable.`.replace(
          /^\s+/gm,
          ''
        )
      );
    }

    const specPath = this.config.specPath;
    if (!specPath) {
      throw new ConfigurationError('No podspec path provided!');
    }

    return {
      specPath,
      trunkToken: process.env.COCOAPODS_TRUNK_TOKEN,
    };
  }

  /**
   * Performs a release to Cocoapods
   *
   * @param version New version to be released
   * @param revision Git commit SHA to be published
   */
  public async publish(_version: string, revision: string): Promise<any> {
    const { owner, repo } = this.githubRepo;
    const specPath = this.cocoapodsConfig.specPath;

    logger.info(`Loading podspec from ${owner}/${repo}:${specPath}`);
    const specContents = await getFile(
      this.github,
      owner,
      repo,
      specPath,
      revision
    );

    if (!specContents) {
      reportError(`Podspec not found at ${owner}/${repo}:${specPath}`);
      return undefined;
    }

    const fileName = basename(specPath);

    await withTempDir(
      async directory => {
        const filePath = join(directory, fileName);
        await writeFile(filePath, specContents, 'utf8');

        logger.info(`Pushing podspec "${fileName}" to cocoapods...`);
        await spawnProcess(COCOAPODS_BIN, ['setup']);
        await spawnProcess(COCOAPODS_BIN, ['trunk', 'push', fileName], {
          cwd: directory,
          env: {
            ...process.env,
            COCOAPODS_TRUNK_TOKEN: this.cocoapodsConfig.trunkToken,
          },
        });
      },
      true,
      'craft-cocoapods-'
    );

    logger.info('Cocoapods release complete');
  }
}
