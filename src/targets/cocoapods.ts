import { Octokit } from '@octokit/rest';
import * as fs from 'fs';
import { basename, join } from 'path';
import { promisify } from 'util';

import {
  GitHubGlobalConfig,
  TargetConfig,
  TypedTargetConfig,
} from '../schemas/project_config';
import { ConfigurationError, reportError } from '../utils/errors';
import { withTempDir } from '../utils/files';
import { getFile, getGitHubClient } from '../utils/githubApi';
import { withRetry, sleep } from '../utils/async';
import { checkExecutableIsPresent, spawnProcess } from '../utils/system';
import { BaseTarget } from './base';
import { BaseArtifactProvider } from '../artifact_providers/base';
const writeFile = promisify(fs.writeFile);

const DEFAULT_COCOAPODS_BIN = 'pod';

/**
 * Command to launch cocoapods
 */
const COCOAPODS_BIN = process.env.COCOAPODS_BIN || DEFAULT_COCOAPODS_BIN;

/** Patterns in pod trunk push output that indicate transient/retriable errors */
const COCOAPODS_TRANSIENT_ERROR_PATTERNS = [
  'timeout',
  'timed out',
  'cdn:',
  'cdn.cocoapods.org',
  'http error',
  '503',
  '502',
  'server error',
  'etimedout',
  'econnreset',
  'econnrefused',
  'socketerror',
  'network error',
];

/** Maximum number of attempts (including the initial one) for `pod trunk push` */
const COCOAPODS_MAX_ATTEMPTS = 5;

/** Initial delay between retries in seconds */
const COCOAPODS_INITIAL_DELAY_SECS = 5;

/** Exponential backoff factor applied to the retry delay */
const COCOAPODS_RETRY_EXP_FACTOR = 2;

/** Options for "cocoapods" target */
export interface CocoapodsTargetOptions {
  /** Path to the spec file inside the repo */
  specPath: string;
}

/** Config fields for cocoapods target */
interface CocoapodsTargetConfig extends Record<string, unknown> {
  specPath?: string;
}

/**
 * Target responsible for publishing to Cocoapods registry
 */
export class CocoapodsTarget extends BaseTarget {
  /** Target name */
  public readonly name: string = 'cocoapods';
  /** Target options */
  public readonly cocoapodsConfig: CocoapodsTargetOptions;
  /** GitHub client */
  public readonly github: Octokit;
  /** GitHub repo configuration */
  public readonly githubRepo: GitHubGlobalConfig;

  public constructor(
    config: TargetConfig,
    artifactProvider: BaseArtifactProvider,
    githubRepo: GitHubGlobalConfig,
  ) {
    super(config, artifactProvider, githubRepo);
    this.cocoapodsConfig = this.getCocoapodsConfig();
    this.github = getGitHubClient();
    this.githubRepo = githubRepo;
    checkExecutableIsPresent(COCOAPODS_BIN);
  }

  /**
   * Extracts Cocoapods target options from the environment
   */
  public getCocoapodsConfig(): CocoapodsTargetOptions {
    const config = this.config as TypedTargetConfig<CocoapodsTargetConfig>;
    const specPath = config.specPath;
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
      revision,
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

        let delay = COCOAPODS_INITIAL_DELAY_SECS;
        await withRetry(
          () =>
            spawnProcess(
              COCOAPODS_BIN,
              [
                'trunk',
                'push',
                fileName,
                '--allow-warnings',
                '--synchronous',
              ],
              {
                cwd: directory,
                env: {
                  ...process.env,
                },
              },
            ),
          COCOAPODS_MAX_ATTEMPTS,
          async err => {
            const message = (err.message || '').toLowerCase();
            const isTransient = COCOAPODS_TRANSIENT_ERROR_PATTERNS.some(
              pattern => message.includes(pattern),
            );
            if (!isTransient) {
              this.logger.warn(
                'pod trunk push failed with a non-transient error, not retrying',
              );
              return false;
            }
            this.logger.warn(
              `pod trunk push failed with a transient error, retrying in ${delay}s...`,
            );
            this.logger.debug('Error details:', err.message);
            await sleep(delay * 1000);
            delay *= COCOAPODS_RETRY_EXP_FACTOR;
            return true;
          },
        );
      },
      true,
      'craft-cocoapods-',
    );

    this.logger.info('Cocoapods release complete');
  }
}
