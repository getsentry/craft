import { BaseStatusProvider, CommitStatus } from './base';
import { ZeusStore } from '../stores/zeus';

/**
 * TODO
 */
export class ZeusStatusProvider extends BaseStatusProvider {
  /** Zeus API client */
  public readonly store: ZeusStore;

  public constructor(repoOwner: string, repoName: string) {
    super();
    this.store = new ZeusStore(repoOwner, repoName);
  }

  /**
   * TODO
   *
   * @param revision revision
   */
  public async getRevisionStatus(revision: string): Promise<CommitStatus> {
    const zeusRevision = await this.store.getRevision(revision);
    if (this.store.isRevisionBuiltSuccessfully(zeusRevision)) {
      return CommitStatus.SUCCESS;
    } else if (this.store.isRevisionPending(zeusRevision)) {
      return CommitStatus.PENDING;
    } else {
      return CommitStatus.FAILURE;
    }
  }

  /** TODO */
  public async getRepositoryInfo(): Promise<any> {
    return this.store.getRepositoryInfo();
  }
}
