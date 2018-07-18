import { TargetConfig } from '../schemas/project_config';
import { ZeusStore } from '../stores/zeus';

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

  public constructor(config: any, store: ZeusStore) {
    this.store = store;
    this.config = config;
  }

  /**
   * Publish artifacts for this target
   *
   * @param version New version to be released
   * @param revision Git commit SHA to be published
   */
  public async publish(_version: string, _revision: string): Promise<any> {
    throw new Error('Not implemented');
  }
}
