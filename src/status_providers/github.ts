import * as Github from '@octokit/rest';

import { logger } from '../logger';
import { BaseStatusProvider, CommitStatus, RepositoryInfo } from './base';
import { getGithubClient } from '../utils/githubApi';
import { ConfigurationError } from '../utils/errors';
import { formatJson } from '../utils/strings';

/**
 * Status provider that talks to GitHub to get commit checks (statuses)
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
   * @inheritDoc
   */
  public async getRevisionStatus(revision: string): Promise<CommitStatus> {
    // TODO move this validation earlier
    let contexts = [];
    if (this.config) {
      contexts = this.config.contexts;

      if (!Array.isArray(contexts) || contexts.length === 0) {
        throw new ConfigurationError(
          `Invalid configuration for GithubStatusProvider`
        );
      }
    }

    // There are two commit status flavours we have to consider:
    // 1. Commit status API
    const revisionStatus = await this.getCommitApiStatus(revision);
    // 2. Check runs API
    const revisionChecks = await this.getRevisionChecks(revision);

    if (contexts.length > 0) {
      for (const context of contexts) {
        // TODO enable regular expression
        const contextString = String(context);
        logger.debug(`Context found: "${contextString}"`);
        const contextResult = this.getStatusForContext(
          contextString,
          revisionStatus,
          revisionChecks
        );
        if (contextResult === CommitStatus.FAILURE) {
          logger.error(`Context "${contextString}" failed, returning early.`);
          return contextResult;
        } else if (contextResult === CommitStatus.PENDING) {
          logger.debug(
            `Context "${contextString}" has state ${contextResult}, we can return early.`
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

      let commitApiStatusResult;
      if (
        revisionStatus.total_count === 0 &&
        revisionStatus.state === 'pending'
      ) {
        // Edge case, this is what GitHub returns when there are no registered legacy checks.
        logger.debug('No legacy checks detected, checking for runs...');
        if (revisionChecks.total_count > 0) {
          logger.debug('Check runs exist, continuing...');
          commitApiStatusResult = CommitStatus.SUCCESS;
        } else {
          logger.warn('No valid build contexts detected, did any checks run?');
          return CommitStatus.FAILURE;
        }
      } else {
        commitApiStatusResult = this.getResultFromCommitApiStatus(
          revisionStatus
        );
      }
      logger.debug(`Commit API status result: ${commitApiStatusResult}`);

      const revisionChecksResult = this.getResultFromRevisionChecks(
        revisionChecks
      );
      logger.debug(`Check runs API result: ${revisionChecksResult}`);

      const results = [commitApiStatusResult, revisionChecksResult];
      if (
        results.includes(CommitStatus.FAILURE) ||
        results.includes(CommitStatus.NOT_FOUND)
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
   * Returns the aggregated status for the given context
   *
   * @param context String that describes a commit check (e.g. a CI run)
   * @param revisionStatus Legacy Commit API response
   * @param revisionChecks Check Runs API response
   */
  private getStatusForContext(
    context: string,
    revisionStatus: Github.ReposGetCombinedStatusForRefResponse,
    revisionChecks: Github.ChecksListForRefResponse
  ): CommitStatus {
    const results = [
      this.getResultFromCommitApiStatus(revisionStatus, context),
      this.getResultFromRevisionChecks(revisionChecks, context),
    ];
    logger.debug(`Status check results: ${formatJson(results)}`);

    if (results.includes(CommitStatus.FAILURE)) {
      logger.error('At least one of the checks has failed, result: FAILURE');
      return CommitStatus.FAILURE;
    } else if (results.includes(CommitStatus.PENDING)) {
      logger.debug('At least one of the checks is pending, result: PENDING');
      return CommitStatus.PENDING;
    } else if (
      results[0] === CommitStatus.NOT_FOUND &&
      results.every(el => el === results[0])
    ) {
      logger.error(`Context "${context}" was not found, result: FAILURE`);
      return CommitStatus.FAILURE;
    } else if (results.includes(CommitStatus.SUCCESS)) {
      logger.debug(`Context "${context}" was build succesffully!`);
      return CommitStatus.SUCCESS;
    } else {
      throw new Error('Unreachable');
    }
  }

  /**
   * Converts GitHub status strings to CommitStatus
   *
   * @param state Status string
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
   * Converts the commit API status response to commit status
   *
   * @param combinedStatus Combined status response returned from legacy API
   * @param context If passed, only result of the corresponding context is considered
   */
  private getResultFromCommitApiStatus(
    combinedStatus: Github.ReposGetCombinedStatusForRefResponse,
    context?: string
  ): CommitStatus {
    if (context) {
      const statuses = combinedStatus.statuses;
      for (const status of statuses) {
        if (status.context === context) {
          return this.stateToCommitStatus(status.state);
        }
      }
      return CommitStatus.NOT_FOUND;
    } else {
      return this.stateToCommitStatus(combinedStatus.state);
    }
  }

  /**
   * Returns aggregated commit status from the Check API response
   *
   * @param revisionChecks Response from GitHub Check API
   * @param context If provided, only the corresponding run is considered
   */
  private getResultFromRevisionChecks(
    revisionChecks: Github.ChecksListForRefResponse,
    context?: string
  ): CommitStatus {
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
      return CommitStatus.NOT_FOUND;
    } else {
      return isSomethingPending ? CommitStatus.PENDING : CommitStatus.SUCCESS;
    }
  }

  /**
   * Gets status from GitHub's legacy commit status API
   *
   * API docs:
   * https://developer.github.com/v3/repos/statuses/#get-the-combined-status-for-a-specific-ref
   *
   * Examples: Appveyor
   *
   * @param revision Git revision SHA
   */
  protected async getCommitApiStatus(
    revision: string
  ): Promise<Github.ReposGetCombinedStatusForRefResponse> {
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
    return revisionStatus;
  }

  /**
   * Gets revision checks from GitHub Check runs API
   *
   * API docs:
   * https://developer.github.com/v3/checks/runs/#list-check-runs-for-a-specific-ref
   *
   * Examples: Travis CI, Azure Pipelines
   *
   * @param revision Git revision SHA
   */
  protected async getRevisionChecks(
    revision: string
  ): Promise<Github.ChecksListForRefResponse> {
    logger.debug(`Fetching Checks API status...`);
    const revisionChecksResponse = await this.github.checks.listForRef({
      owner: this.repoOwner,
      ref: revision,
      repo: this.repoName,
    });
    const revisionChecks = revisionChecksResponse.data;
    logger.debug(`Revision checks received: "${formatJson(revisionChecks)}"`);

    return revisionChecks;
  }

  /**
   * @inheritDoc
   */
  public async getRepositoryInfo(): Promise<RepositoryInfo> {
    return this.github.repos.get({
      owner: this.repoOwner,
      repo: this.repoName,
    });
  }
}
