import { Octokit } from '@octokit/rest';
import * as fs from 'fs';
import { basename, join } from 'path';
import { promisify } from 'util';

import { GithubGlobalConfig, TargetConfig } from '../schemas/project_config';
import { ConfigurationError, reportError } from '../utils/errors';
import { withTempDir } from '../utils/files';
import { getFile, getGithubClient } from '../utils/githubApi';
import { checkExecutableIsPresent, spawnProcess } from '../utils/system';
import { BaseTarget } from './base';
import { BaseArtifactProvider } from '../artifact_providers/base';
const writeFile = promisify(fs.writeFile);

const DEFAULT_COCOAPODS_BIN = 'pod';

/**
 * Command to launch cocoapods
 */
const COCOAPODS_BIN = process.env.COCOAPODS_BIN || DEFAULT_COCOAPODS_BIN;

/** Options for "cocoapods" target */
export interface CocoapodsTargetOptions {
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
  public readonly github: Octokit;
  /** Github repo configuration */
  public readonly githubRepo: GithubGlobalConfig;

  public constructor(
    config: TargetConfig,
    artifactProvider: BaseArtifactProvider,
    githubRepo: GithubGlobalConfig
  ) {
    super(config, artifactProvider, githubRepo);
    this.cocoapodsConfig = this.getCocoapodsConfig();
    this.github = getGithubClient();
    this.githubRepo = githubRepo;
    checkExecutableIsPresent(COCOAPODS_BIN);
  }

  /**
   * Extracts Cocoapods target options from the environment
   */
  public getCocoapodsConfig(): CocoapodsTargetOptions {
    const specPath = this.config.specPath;
    if (!specPath) {
      throw new ConfigurationError('No podspec path provided!');
    }

    return {
      specPath,
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

    this.logger.info(`Loading podspec from ${owner}/${repo}:${specPath}`);
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

        this.logger.info(`Pushing podspec "${fileName}" to cocoapods...`);
        await spawnProcess(COCOAPODS_BIN, ['setup']);
        await spawnProcess(
          COCOAPODS_BIN,
          ['trunk', 'push', fileName, '--allow-warnings'],
          {
            cwd: directory,
            env: {
              ...process.env,
            },
          }
        );
      },
      true,
      'craft-cocoapods-'
    );

    this.logger.info('Cocoapods release complete');
  }
}
