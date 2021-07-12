import { logger as loggerRaw } from '../logger';
import { GithubGlobalConfig, TargetConfig } from '../schemas/project_config';
import {
  parseFilterOptions,
  RawFilterOptions,
  ParsedFilterOptions,
} from '../artifact_providers/base';
import { stringToRegexp } from '../utils/filters';
import {
  BaseArtifactProvider,
  RemoteArtifact,
} from '../artifact_providers/base';

/**
 * Base class for all remote targets
 */
export class BaseTarget {
  public readonly id: string;
  protected readonly logger: typeof loggerRaw;
  /** Artifact provider */
  public readonly artifactProvider: BaseArtifactProvider;
  /** Unparsed target configuration */
  public readonly config: TargetConfig;
  /** Artifact filtering options for the target */
  public readonly filterOptions: ParsedFilterOptions;
  /** Github repo configuration */
  public readonly githubRepo?: GithubGlobalConfig;

  public static getId(target: TargetConfig): string {
    return target.id
      ? `${target.name}[${target.id}]`
      : target.name || '__undefined__';
  }

  public constructor(
    config: TargetConfig,
    artifactProvider: BaseArtifactProvider,
    githubRepo?: GithubGlobalConfig
  ) {
    this.logger = loggerRaw.withScope(`[target/${config.name}]`);
    this.artifactProvider = artifactProvider;
    this.config = config;
    this.id = BaseTarget.getId(config);
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
    defaultFilterOptions: RawFilterOptions = {}
  ): Promise<RemoteArtifact[]> {
    const filterOptions = {
      ...parseFilterOptions(defaultFilterOptions),
      ...this.filterOptions,
    };
    this.logger.debug(
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
