import { BaseStatusProvider, CommitStatus, RepositoryInfo } from './base';
import { ZeusStore } from '../stores/zeus';

/**
 * TODO
 */
export class ZeusStatusProvider extends BaseStatusProvider {
  /** Zeus API client */
  public readonly store: ZeusStore;

  public constructor(repoOwner: string, repoName: string, config?: any) {
    super();
    this.store = new ZeusStore(repoOwner, repoName);
    this.config = config;
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
