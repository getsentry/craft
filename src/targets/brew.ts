import { mapLimit } from 'async';
import * as Github from '@octokit/rest';
import { shouldPerform } from 'dryrun';
import * as _ from 'lodash';

import { getGlobalGithubConfig } from '../config';
import { logger as loggerRaw } from '../logger';
import { GithubGlobalConfig, TargetConfig } from '../schemas/project_config';
import { ConfigurationError } from '../utils/errors';
import { getGithubClient } from '../utils/githubApi';
import { renderTemplateSafe } from '../utils/strings';
import { HashAlgorithm, HashOutputFormat } from '../utils/system';
import { BaseTarget } from './base';
import {
  BaseArtifactProvider,
  MAX_DOWNLOAD_CONCURRENCY,
} from '../artifact_providers/base';

const logger = loggerRaw.withScope('[brew]');

/**
 * Regex used to parse homebrew taps (github repositories)
 */
const TAP_REGEX = /^([a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38})\/([-_.\w\d]+)$/i;

/** Homebrew tap parameters */
export interface TapRepo {
  /** Tap owner */
  owner: string;
  /** Tap repo name */
  repo: string;
}

/** Target options for "brew" */
export interface BrewTargetOptions extends TargetConfig {
  /** Brew tap repository */
  tapRepo: TapRepo;
  /** Template string that will be part of thew formula */
  template: string;
  /** Formula name */
  formula?: string;
  /** Formula path */
  path?: string;
}

/**
 * Target responsible for publishing HomeBrew formulas
 */
export class BrewTarget extends BaseTarget {
  /** Target name */
  public readonly name: string = 'brew';
  /** Target options */
  public readonly brewConfig: BrewTargetOptions;
  /** Github client */
  public readonly github: Github;
  /** Github repo configuration */
  public readonly githubRepo: GithubGlobalConfig;

  public constructor(config: any, artifactProvider: BaseArtifactProvider) {
    super(config, artifactProvider);
    this.brewConfig = this.getBrewConfig();
    this.github = getGithubClient();
    this.githubRepo = getGlobalGithubConfig();
  }

  /**
   * Extracts Brew target options from the raw configuration
   */
  public getBrewConfig(): BrewTargetOptions {
    const template = this.config.template;
    if (!template) {
      throw new ConfigurationError(
        'Please specify Formula template in the "brew" target configuration.'
      );
    }
    const { formula, path } = this.config;
    return {
      formula,
      path,
      tapRepo: this.getTapRepo(),
      template,
    };
  }

  /**
   * Extracts repository information for a homebrew tap from the given context
   *
   * If no explicit tap is given, 'homebrew/core' is assumed. Otherwise, the
   * string "<owner>/>tap>" is transformed to "<owner>/homebrew-<tap>".
   *
   * @param config Configuration for the brew target
   * @returns The owner and repository of the tap
   */
  public getTapRepo(): TapRepo {
    const { tap } = this.config;
    if (!tap) {
      return {
        owner: 'homebrew',
        repo: 'homebrew-core',
      };
    }

    const match = TAP_REGEX.exec(tap);
    if (!match) {
      throw new ConfigurationError(`Invalid tap name: ${tap}`);
    }

    return {
      owner: match[1],
      repo: `homebrew-${match[2]}`,
    };
  }

  /**
   * Resolves the content sha of a formula at the specified location. If the
   * formula does not exist, `undefined` is returned.
   *
   * @param github A Github context
   * @param tap Owner and repository of the tap
   * @param path The path to the formula
   * @returns The SHA of the file, if it exists; otherwise undefined
   */
  public async getFormulaSha(path: string): Promise<string | undefined> {
    try {
      const tap = this.brewConfig.tapRepo;
      logger.debug(`Loading SHA for ${tap.owner}/${tap.repo}:${path}`);
      const response = await this.github.repos.getContents({ ...tap, path });
      if (response.data instanceof Array) {
        return undefined;
      }
      return response.data.sha;
    } catch (e) {
      if (e.status === 404) {
        return undefined;
      }
      throw e;
    }
  }

  /**
   * Pushes a new formula to a homebrew tap
   *
   * @param version The new version
   * @param revision The SHA revision of the new version
   */
  public async publish(version: string, revision: string): Promise<any> {
    const { formula, path, template, tapRepo } = this.brewConfig;
    const { owner, repo } = this.githubRepo;

    // Get default formula name and location from the config
    const formulaName = formula || repo;
    const formulaPath = path
      ? `${path}/${formulaName}.rb`
      : `Formula/${formulaName}.rb`;

    // Format checksums and the tag version into the formula file
    const filesList = await this.getArtifactsForRevision(revision);
    logger.debug(
      'Downloading artifacts for the revision:',
      JSON.stringify(filesList.map(file => file.filename))
    );

    const checksums: any = {};

    // tslint:disable-next-line:await-promise
    await mapLimit(filesList, MAX_DOWNLOAD_CONCURRENCY, async file => {
      checksums[file.filename] = await this.artifactProvider.getChecksum(
        file,
        HashAlgorithm.SHA256,
        HashOutputFormat.Hex
      );
    });

    const data = renderTemplateSafe(template, {
      checksums,
      revision,
      version,
    });
    logger.debug(`Homebrew formula for ${formulaName}:\n${data}`);

    // Try to find the repository to publish in
    if (tapRepo.owner !== owner) {
      // TODO: Create a PR if we have no push rights to this repo
      logger.warn('Skipping homebrew release: PRs not supported yet');
      return undefined;
    }

    const params = {
      content: Buffer.from(data).toString('base64'),
      message: `release: ${formulaName} ${version}`,
      owner: tapRepo.owner,
      path: formulaPath,
      repo: tapRepo.repo,
      sha: (await this.getFormulaSha(formulaPath)) || '',
    };

    logger.info(
      `Releasing ${owner}/${repo} tag ${version} ` +
        `to homebrew tap ${tapRepo.owner}/${tapRepo.repo} ` +
        `formula ${formulaName}`
    );

    const action = params.sha ? 'Updating' : 'Creating';
    logger.debug(
      `${action} file ${params.owner}/${params.repo}:${params.path} (${params.sha})`
    );

    if (shouldPerform()) {
      await this.github.repos.createOrUpdateFile(params);
    } else {
      logger.info(`[dry-run] Skipping file action: ${action}`);
    }
    logger.info('Homebrew release complete');
  }
}
