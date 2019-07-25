import { Artifact } from '@zeus-ci/sdk';

import { logger } from '../logger';
import { TargetConfig } from '../schemas/project_config';
import { FilterOptions, ZeusStore } from '../stores/zeus';
import { stringToRegexp } from '../utils/filters';

// TODO: make abstract?
/**
 * Base class for all remote targets
 */
export class BaseTarget {
  /** Target name */
  public readonly name: string = 'base';
  /** Artifact store */
  public readonly store: ZeusStore;
  /** Unparsed target configuration */
  public readonly config: TargetConfig;
  /** Artifact filtering options for the target */
  public readonly filterOptions: FilterOptions;

  public constructor(config: TargetConfig, store: ZeusStore) {
    this.store = store;
    this.config = config;
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
  public async publish(_version: string, _revision: string): Promise<void> {
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
  ): Promise<Artifact[]> {
    const filterOptions = {
      ...defaultFilterOptions,
      ...this.filterOptions,
    };
    logger.debug(
      `Getting artifact list for revision "${revision}", filtering options: {includeNames: ${
        filterOptions.includeNames
      }, excludeNames:${filterOptions.excludeNames}}`
    );
    return this.store.filterArtifactsForRevision(revision, filterOptions);
  }
}
