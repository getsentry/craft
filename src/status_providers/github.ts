import * as Github from '@octokit/rest';

import { logger } from '../logger';
import { BaseStatusProvider, CommitStatus } from './base';
import { getGithubClient } from '../utils/githubApi';

/**
 * TODO
 */
export class GithubStatusProvider extends BaseStatusProvider {
  /** Github client */
  private readonly github: Github;

  public constructor(
    private readonly repoOwner: string,
    private readonly repoName: string
  ) {
    super();
    this.github = getGithubClient();
  }

  /**
   * TODO
   *
   * @param revision revision
   */
  public async getRevisionStatus(revision: string): Promise<CommitStatus> {
    const githubRevision = await this.github.repos.getCombinedStatusForRef({
      owner: this.repoOwner,
      ref: revision,
      repo: this.repoName,
    });
    logger.debug(
      `Revision Status received: "${JSON.stringify(githubRevision, null, 4)}"`
    );
    if (githubRevision.data.state === 'success') {
      return CommitStatus.SUCCESS;
    } else if (githubRevision.data.state === 'pending') {
      return CommitStatus.PENDING;
    } else {
      return CommitStatus.FAILURE;
    }
  }

  /** TODO */
  public async getRepositoryInfo(): Promise<any> {
    return this.github.repos.get({
      owner: this.repoOwner,
      repo: this.repoName,
    });
  }
}
