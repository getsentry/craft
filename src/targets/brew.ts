import * as Github from '@octokit/rest';
import { shouldPerform } from 'dryrun';
import * as _ from 'lodash';
import { basename } from 'path';

import { getGlobalGithubConfig } from '../config';
import loggerRaw from '../logger';
import { TargetConfig } from '../schemas/project_config';
import { ZeusStore } from '../stores/zeus';
import { promiseProps } from '../utils/async';
import { getGithubClient } from '../utils/github_api';
import { calculateChecksum } from '../utils/system';
import { BaseTarget } from './base';
import { GithubTargetOptions } from './github';

const logger = loggerRaw.withScope('[brew]');

/**
 * Regex used to parse homebrew taps (github repositories)
 */
const TAP_REGEX = /^([a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38})\/([-_.\w\d]+)$/i;

/** Homebrew tap parameters */
export interface TapRepo {
  owner: string;
  repo: string;
}

/** Target options for "brew" */
export interface BrewTargetOptions extends TargetConfig {
  tapRepo: TapRepo;
  template: string;
  formula?: string;
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
  public readonly githubRepo: GithubTargetOptions;

  public constructor(config: any, store: ZeusStore) {
    super(config, store);
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
      throw new Error(
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
      throw new Error(`Invalid tap name: ${tap}`);
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
      const response = await this.github.repos.getContent({ ...tap, path });
      return response.data.sha;
    } catch (e) {
      if (e.code === 404) {
        return undefined;
      }
      throw e;
    }
  }

  /**
   * Pushes a new formula to a homebrew tap
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
    const filesList = await this.store.listArtifactsForRevision(revision);
    logger.debug(
      'Downloading artifacts for the revision:',
      JSON.stringify(filesList.map(file => file.name))
    );
    const files = await this.store.downloadArtifacts(filesList);
    const fileMap: { [key: string]: string } = _.keyBy(files, basename);
    const promises = _.mapValues(fileMap, async filePath =>
      calculateChecksum(filePath)
    );
    const checksums = await promiseProps(promises);
    const data = _.template(template)({
      checksums,
      ref: version,
      sha: revision,
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

    if (params.sha) {
      logger.debug(
        `Updating file ${params.owner}/${params.repo}:${params.path} (${
          params.sha
        })`
      );
      if (shouldPerform()) {
        await this.github.repos.updateFile(params);
      } else {
        logger.info('[dry-run] Skipping file update');
      }
    } else {
      logger.debug(
        `Creating new file ${params.owner}/${params.repo}:${params.path}`
      );
      if (shouldPerform()) {
        await this.github.repos.createFile(params);
      } else {
        logger.info('[dry-run] Skipping file creation');
      }
    }
    logger.info('Homebrew release completed');
  }
}
