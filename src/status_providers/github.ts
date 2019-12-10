import * as Github from '@octokit/rest';

import { logger } from '../logger';
import { BaseStatusProvider, CommitStatus } from './base';
import { getGithubClient } from '../utils/githubApi';
import { reportError } from '../utils/errors';

/**
 * TODO
 */
export class GithubStatusProvider extends BaseStatusProvider {
  /** Github client */
  private readonly github: Github;

  public constructor(
    private readonly repoOwner: string,
    private readonly repoName: string,
    config?: any
  ) {
    super();
    this.github = getGithubClient();
    this.config = config;
  }

  /**
   * TODO
   *
   * @param revision revision
   */
  public async getRevisionStatus(revision: string): Promise<CommitStatus> {
    // There are two commit status flavours we have to consider:
    // 1. Commit status API
    // https://developer.github.com/v3/repos/statuses/#get-the-combined-status-for-a-specific-ref
    // Examples: Appveyor
    // 2. Check runs API
    // https://developer.github.com/v3/checks/runs/#list-check-runs-for-a-specific-ref
    // Examples: Travis CI

    // 1. Commit status API
    logger.info(`Fetching combined revision status...`);
    const revisionStatus = await this.github.repos.getCombinedStatusForRef({
      owner: this.repoOwner,
      ref: revision,
      repo: this.repoName,
    });
    logger.debug(
      `Revision combined status received: "${JSON.stringify(
        revisionStatus,
        null,
        4
      )}"`
    );

    // No config provided: just look at the combined status
    if (this.config === undefined) {
      logger.info(
        'No config provided for Github status provider, skipping the run checks'
      );
      const state = revisionStatus.data.state;
      if (state === 'success') {
        return CommitStatus.SUCCESS;
      } else if (state === 'pending') {
        return CommitStatus.PENDING;
      } else {
        return CommitStatus.FAILURE;
      }
    }

    const contexts = (this.config || { contexts: [] }).contexts;
    // TODO move this validation earlier
    if (!Array.isArray(contexts) || contexts.length === 0) {
      reportError(`Invalid configuration for GithubStatusProvider`);
    }

    // 2. Checks
    logger.info(`Fetching Checks API status...`);
    const revisionChecks = await this.github.checks.listForRef({
      owner: this.repoOwner,
      ref: revision,
      repo: this.repoName,
    });
    logger.debug(
      `Revision checks received: "${JSON.stringify(revisionChecks, null, 4)}"`
    );

    for (const context of contexts) {
      const contextString = String(context);
      logger.debug(`Context found: ${contextString}`);
    }
    return CommitStatus.FAILURE;
  }

  /** TODO */
  public async getRepositoryInfo(): Promise<any> {
    return this.github.repos.get({
      owner: this.repoOwner,
      repo: this.repoName,
    });
  }
}
