import { logger as loggerRaw } from '../logger';
import {
  BaseArtifactProvider,
  RemoteArtifact,
} from '../artifact_providers/base';
import { reportError } from '../utils/errors';
import { checkExecutableIsPresent, spawnProcess } from '../utils/system';
import { BaseTarget } from './base';
import { GithubGlobalConfig, TargetConfig } from '../schemas/project_config';

const logger = loggerRaw.withScope('[gem]');

const DEFAULT_GEM_BIN = 'gem';

/**
 * Command to launch gem
 */
const GEM_BIN = process.env.GEM_BIN || DEFAULT_GEM_BIN;

/**
 * RegExp for gems
 */
const DEFAULT_GEM_REGEX = /^.*(\.gem)$/;

/**
 * Target responsible for publishing releases to Ruby Gems (https://rubygems.org)
 */
export class GemTarget extends BaseTarget {
  /** Target name */
  public readonly name: string = 'gem';

  public constructor(
    config: TargetConfig,
    artifactProvider: BaseArtifactProvider,
    githubRepo: GithubGlobalConfig
  ) {
    super(config, artifactProvider, githubRepo);
    checkExecutableIsPresent(GEM_BIN);
  }

  /**
   * Uploads a gem to rubygems
   *
   * @param path Absolute path to the archive to upload
   * @returns A promise that resolves when the gem pushed
   */
  public async pushGem(path: string): Promise<any> {
    return spawnProcess(GEM_BIN, ['push', path]);
  }

  /**
   * Pushes a gem to rubygems.org
   *
   * @param version New version to be released
   * @param revision Git commit SHA to be published
   */
  public async publish(_version: string, revision: string): Promise<any> {
    logger.debug('Fetching artifact list...');
    const packageFiles = await this.getArtifactsForRevision(revision, {
      includeNames: DEFAULT_GEM_REGEX,
    });

    if (!packageFiles.length) {
      reportError('Cannot push gem: no packages found');
      return undefined;
    }

    await Promise.all(
      packageFiles.map(async (file: RemoteArtifact) => {
        const path = await this.artifactProvider.downloadArtifact(file);
        logger.info(`Pushing gem "${file.filename}"`);
        return this.pushGem(path);
      })
    );

    logger.info('Successfully registered gem');
  }
}
