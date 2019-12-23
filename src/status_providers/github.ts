import * as Github from '@octokit/rest';

import { logger } from '../logger';
import { BaseStatusProvider, CommitStatus } from './base';
import { getGithubClient } from '../utils/githubApi';
import { reportError } from '../utils/errors';
import { formatJson } from '../utils/strings';

/**
 * TODO
 */
enum RevisionAdditionalStatus {
  /** TODO */
  NotFound = 'NotFound',
}

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
    const contexts = (this.config || { contexts: [] }).contexts;
    // TODO move this validation earlier
    if (!Array.isArray(contexts) || contexts.length === 0) {
      reportError(`Invalid configuration for GithubStatusProvider`);
    }

    // There are two commit status flavours we have to consider:
    // 1. Commit status API
    // https://developer.github.com/v3/repos/statuses/#get-the-combined-status-for-a-specific-ref
    // Examples: Appveyor
    // 2. Check runs API
    // https://developer.github.com/v3/checks/runs/#list-check-runs-for-a-specific-ref
    // Examples: Travis CI

    const [revisionStatus, revisionChecks] = await this.getAllStatuses(
      revision
    );

    if (contexts && contexts.length > 0) {
      for (const context of contexts) {
        // TODO enable regular expression
        const contextString = String(context);
        logger.debug(`Context found: "${contextString}"`);
        const contextResult = this.getStatusForContext(
          contextString,
          revisionStatus,
          revisionChecks
        );
        if (
          contextResult === CommitStatus.FAILURE ||
          contextResult === CommitStatus.PENDING
        ) {
          logger.debug(
            `The context has state ${contextResult}, we can return early`
          );
          return contextResult;
        }
      }
      logger.debug('All contexts were build successfully!');
      return CommitStatus.SUCCESS;
    } else {
      logger.info(
        'No config provided for Github status provider, calculating the combined status...'
      );
      const results = [
        this.getResultFromRevisionStatus(revisionStatus),
        this.getResultFromRevisionChecks(revisionChecks),
      ];
      if (
        results.includes(CommitStatus.FAILURE) ||
        results.includes(RevisionAdditionalStatus.NotFound)
      ) {
        return CommitStatus.FAILURE;
      } else if (results.includes(CommitStatus.PENDING)) {
        return CommitStatus.PENDING;
      } else {
        return CommitStatus.SUCCESS;
      }
    }
  }

  /**
   * TODO
   *
   * @param context TODO
   * @param revisionStatus TODO
   * @param revisionChecks TODO
   */
  private getStatusForContext(
    context: string,
    revisionStatus: Github.ReposGetCombinedStatusForRefResponse,
    revisionChecks: Github.ChecksListForRefResponse
  ): CommitStatus {
    const results = [
      this.getResultFromRevisionStatus(revisionStatus, context),
      this.getResultFromRevisionChecks(revisionChecks, context),
    ];
    logger.debug(`Status check results: ${formatJson(results)}`);

    if (results.includes(CommitStatus.FAILURE)) {
      logger.debug('At least one of the checks has failed, result: FAILURE');
      return CommitStatus.FAILURE;
    } else if (results.includes(CommitStatus.PENDING)) {
      logger.debug('At least one of the checks is pending, result: PENDING');
      return CommitStatus.PENDING;
    } else if (
      results[0] === RevisionAdditionalStatus.NotFound &&
      results.every(el => el === results[0])
    ) {
      logger.debug('The context was not found (yet), result: PENDING');
      return CommitStatus.PENDING;
    } else if (results.includes(CommitStatus.SUCCESS)) {
      logger.debug('The context was build succesffully.');
      return CommitStatus.SUCCESS;
    } else {
      throw new Error('Unreachable');
    }
  }

  /**
   * TODO
   * @param state  TODO
   */
  private stateToCommitStatus(state: string): CommitStatus {
    if (state === 'success') {
      return CommitStatus.SUCCESS;
    } else if (state === 'pending') {
      return CommitStatus.PENDING;
    } else {
      return CommitStatus.FAILURE;
    }
  }

  /**
   * TODO
   * @param combinedStatus TODO
   * @param context TODO
   */
  private getResultFromRevisionStatus(
    combinedStatus: Github.ReposGetCombinedStatusForRefResponse,
    context?: string
  ): CommitStatus | RevisionAdditionalStatus {
    if (context) {
      const statuses = combinedStatus.statuses;
      for (const status of statuses) {
        if (status.context === context) {
          return this.stateToCommitStatus(status.state);
        }
      }
      return RevisionAdditionalStatus.NotFound;
    } else {
      return this.stateToCommitStatus(combinedStatus.state);
    }
  }

  /**
   * TODO
   * @param combinedStatus TODO
   * @param context TODO
   */
  private getResultFromRevisionChecks(
    revisionChecks: Github.ChecksListForRefResponse,
    context?: string
  ): CommitStatus | RevisionAdditionalStatus {
    // Check runs: we have an array of runs, and each of them has a status
    let isSomethingPending = false;
    let found = false;
    for (const run of revisionChecks.check_runs) {
      if (context && run.name !== context) {
        continue;
      }
      if (run.status === 'completed') {
        if (run.conclusion !== 'success') {
          return CommitStatus.FAILURE;
        }
      } else {
        isSomethingPending = true;
      }
      if (context) {
        found = true;
        break;
      }
    }
    if (context && !found) {
      return RevisionAdditionalStatus.NotFound;
    } else {
      return isSomethingPending ? CommitStatus.PENDING : CommitStatus.SUCCESS;
    }
  }

  /**
   * TODO
   *
   * @param revision TODO
   */
  public async getAllStatuses(
    revision: string
  ): Promise<
    [
      Github.ReposGetCombinedStatusForRefResponse,
      Github.ChecksListForRefResponse
    ]
  > {
    // 1. Commit status API
    logger.debug(`Fetching combined revision status...`);
    const revisionStatusResponse = await this.github.repos.getCombinedStatusForRef(
      {
        owner: this.repoOwner,
        ref: revision,
        repo: this.repoName,
      }
    );
    const revisionStatus = revisionStatusResponse.data;
    logger.debug(
      `Revision combined status received: "${formatJson(revisionStatus)}"`
    );

    // 2. Checks
    logger.debug(`Fetching Checks API status...`);
    const revisionChecksResponse = await this.github.checks.listForRef({
      owner: this.repoOwner,
      ref: revision,
      repo: this.repoName,
    });
    const revisionChecks = revisionChecksResponse.data;
    logger.debug(`Revision checks received: "${formatJson(revisionChecks)}"`);

    return [revisionStatus, revisionChecks];
  }

  /** TODO */
  public async getRepositoryInfo(): Promise<any> {
    return this.github.repos.get({
      owner: this.repoOwner,
      repo: this.repoName,
    });
  }
}
