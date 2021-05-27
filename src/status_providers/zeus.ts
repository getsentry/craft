import {
  BaseStatusProvider,
  CommitStatus,
  RepositoryInfo,
  StatusProviderConfig,
} from './base';
import { ZeusStore } from '../stores/zeus';
import { GithubGlobalConfig } from 'src/schemas/project_config';

/**
 * TODO
 */
export class ZeusStatusProvider extends BaseStatusProvider {
  /** Zeus API client */
  public readonly store: ZeusStore;

  public constructor(
    config: StatusProviderConfig,
    githubConfig: GithubGlobalConfig
  ) {
    super(config, githubConfig);
    this.store = new ZeusStore(this.githubConfig.owner, this.githubConfig.repo);
  }

  /**
   * TODO
   *
   * @param revision revision
   */
  public async getRevisionStatus(revision: string): Promise<CommitStatus> {
    let zeusRevision;
    try {
      zeusRevision = await this.store.getRevision(revision);
    } catch (e) {
      const errorMessage: string = e.message || '';
      if (errorMessage.match(/404 not found|resource not found/i)) {
        return CommitStatus.NOT_FOUND;
      }
      throw e;
    }

    if (this.store.isRevisionBuiltSuccessfully(zeusRevision)) {
      return CommitStatus.SUCCESS;
    } else if (this.store.isRevisionPending(zeusRevision)) {
      return CommitStatus.PENDING;
    } else {
      return CommitStatus.FAILURE;
    }
  }

  /** TODO */
  public async getRepositoryInfo(): Promise<RepositoryInfo> {
    return this.store.getRepositoryInfo();
  }
}
