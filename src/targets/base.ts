import { logger } from '../logger';
import { GithubGlobalConfig, TargetConfig } from '../schemas/project_config';
import { FilterOptions } from '../stores/zeus';
import { stringToRegexp } from '../utils/filters';
import {
  BaseArtifactProvider,
  RemoteArtifact,
} from '../artifact_providers/base';

// TODO: make abstract?
/**
 * Base class for all remote targets
 */
export class BaseTarget {
  /** Target name */
  public readonly name: string = 'base';
  /** Artifact provider */
  public readonly artifactProvider: BaseArtifactProvider;
  /** Unparsed target configuration */
  public readonly config: TargetConfig;
  /** Artifact filtering options for the target */
  public readonly filterOptions: FilterOptions;
  /** Github repo configuration */
  public readonly githubRepo: GithubGlobalConfig;

  public constructor(
    config: TargetConfig,
    artifactProvider: BaseArtifactProvider,
    githubRepo: GithubGlobalConfig
  ) {
    this.artifactProvider = artifactProvider;
    this.config = config;
    this.githubRepo = githubRepo;
    this.filterOptions = {};
    if (this.config.includeNames) {
      this.filterOptions.includeNames = stringToRegexp(
        this.config.includeNames
      );
    }
    if (this.config.excludeNames) {
      this.filterOptions.excludeNames = stringToRegexp(
        this.config.excludeNames
      );
    }
  }

  /**
   * Publish artifacts for this target
   *
   * @param version New version to be released
   * @param revision Git commit SHA to be published
   */
  public async publish(
    _version: string,

    _revision: string
  ): Promise<void> {
    throw new Error('Not implemented');
    return;
  }

  /**
   * A helper proxy function that takes passed include/exclude target regex
   * into account.
   *
   * @param revision Git commit SHA to be published
   * @param defaultFilterOptions Default filtering options
   * @returns A list of relevant artifacts
   */
  public async getArtifactsForRevision(
    revision: string,
    defaultFilterOptions: FilterOptions = {}
  ): Promise<RemoteArtifact[]> {
    const filterOptions = {
      ...defaultFilterOptions,
      ...this.filterOptions,
    };
    // This is a hacky legacy way of skipping artifact downloads.
    // Can be removed when we fully migrate from ZeusStore to artifact providers.
    if (filterOptions.includeNames?.source === 'none') {
      logger.debug(
        `target.includeNames is 'none', skipping artifacts downloads.`
      );
      return [];
    }
    logger.debug(
      `Getting artifact list for revision "${revision}", filtering options: {includeNames: ${String(
        filterOptions.includeNames
      )}, excludeNames:${String(filterOptions.excludeNames)}}`
    );
    return this.artifactProvider.filterArtifactsForRevision(
      revision,
      filterOptions
    );
  }
}
