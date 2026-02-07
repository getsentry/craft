import { mapLimit } from 'async';
import { Octokit } from '@octokit/rest';

import {
  GitHubGlobalConfig,
  TargetConfig,
  TypedTargetConfig,
} from '../schemas/project_config';
import { ConfigurationError } from '../utils/errors';
import { getGitHubClient } from '../utils/githubApi';
import { renderTemplateSafe } from '../utils/strings';
import { HashAlgorithm, HashOutputFormat } from '../utils/system';
import { isPreviewRelease, parseVersion } from '../utils/version';
import { BaseTarget } from './base';
import {
  BaseArtifactProvider,
  MAX_DOWNLOAD_CONCURRENCY,
  RemoteArtifact,
} from '../artifact_providers/base';

/** Brew target configuration fields */
interface BrewConfigFields extends Record<string, unknown> {
  tap?: string;
  template?: string;
  formula?: string;
  path?: string;
}

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
export interface BrewTargetOptions {
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
    this.brewConfig = this.getBrewConfig();
    this.github = getGitHubClient();
    this.githubRepo = githubRepo;
  }

  /**
   * Extracts Brew target options from the raw configuration
   */
  public getBrewConfig(): BrewTargetOptions {
    const config = this.config as TypedTargetConfig<BrewConfigFields>;
    const template = config.template;
    if (!template) {
      throw new ConfigurationError(
        'Please specify Formula template in the "brew" target configuration.',
      );
    }
    const { formula, path } = config;
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
    const config = this.config as TypedTargetConfig<BrewConfigFields>;
    const { tap } = config;
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
   * Resolves the formula name by interpolating version variables.
   *
   * Supports Mustache-style templates with the following variables:
   * - `{{{version}}}`: Full version string (e.g., "10.2.3")
   * - `{{{major}}}`: Major version number (e.g., "10")
   * - `{{{minor}}}`: Minor version number (e.g., "2")
   * - `{{{patch}}}`: Patch version number (e.g., "3")
   *
   * Example: `sentry-cli-v{{{major}}}` becomes `sentry-cli-v10`
   *
   * @param version The version string to interpolate
   * @returns The resolved formula name with variables substituted
   */
  public resolveFormulaName(version: string): string {
    const formulaTemplate = this.brewConfig.formula || this.githubRepo.repo;
    const parsedVersion = parseVersion(version);

    const context = {
      version,
      major: parsedVersion?.major ?? '',
      minor: parsedVersion?.minor ?? '',
      patch: parsedVersion?.patch ?? '',
    };

    return renderTemplateSafe(formulaTemplate, context);
  }

  /**
   * Resolves the content sha of a formula at the specified location. If the
   * formula does not exist, `undefined` is returned.
   *
   * @param github A GitHub context
   * @param tap Owner and repository of the tap
   * @param path The path to the formula
   * @returns The SHA of the file, if it exists; otherwise undefined
   */
  public async getFormulaSha(path: string): Promise<string | undefined> {
    try {
      const tap = this.brewConfig.tapRepo;
      this.logger.debug(`Loading SHA for ${tap.owner}/${tap.repo}:${path}`);
      const response = await this.github.repos.getContent({
        ...tap,
        path,
      });
      if (response.data instanceof Array) {
        return undefined;
      }
      return response.data.sha;
    } catch (e: any) {
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
    // Skip pre-release versions as Homebrew doesn't understand them
    if (isPreviewRelease(version)) {
      this.logger.info(
        'Skipping Homebrew release for pre-release version: ' + version,
      );
      return undefined;
    }

    const { path, template, tapRepo } = this.brewConfig;

    // Get formula name (supports mustache templates with version variables)
    const formulaName = this.resolveFormulaName(version);
    const formulaPath = path
      ? `${path}/${formulaName}.rb`
      : `Formula/${formulaName}.rb`;

    // Format checksums and the tag version into the formula file
    const filesList = await this.getArtifactsForRevision(revision);
    this.logger.debug('Downloading artifacts for the revision');
    this.logger.trace(filesList.map(file => file.filename));

    const checksums: any = {};

    await mapLimit(
      filesList,
      MAX_DOWNLOAD_CONCURRENCY,
      async (file: RemoteArtifact) => {
        const key = file.filename.replace(version, '__VERSION__');
        checksums[key] = await this.artifactProvider.getChecksum(
          file,
          HashAlgorithm.SHA256,
          HashOutputFormat.Hex,
        );
      },
    );

    const data = renderTemplateSafe(template, {
      checksums,
      revision,
      version,
    });
    this.logger.debug(`Homebrew formula for ${formulaName}:\n${data}`);

    // Try to find the repository to publish in
    if (tapRepo.owner !== this.githubRepo.owner) {
      // TODO: Create a PR if we have no push rights to this repo
      this.logger.warn('Skipping homebrew release: PRs not supported yet');
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

    this.logger.info(
      `Releasing ${this.githubRepo.owner}/${this.githubRepo.repo} tag ${version} ` +
        `to homebrew tap ${tapRepo.owner}/${tapRepo.repo} ` +
        `formula ${formulaName}`,
    );

    const action = params.sha ? 'Updating' : 'Creating';
    this.logger.debug(
      `${action} file ${params.owner}/${params.repo}:${params.path} (${params.sha})`,
    );

    await this.github.repos.createOrUpdateFileContents(params);
    this.logger.info('Homebrew release complete');
  }
}
