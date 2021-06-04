import ora from 'ora';

import { sleep } from '../utils/async';

import { reportError } from '../utils/errors';

import { logger as loggerRaw } from '../logger';
import { GithubGlobalConfig } from 'src/schemas/project_config';

const MILLISECONDS = 1000;
/** Max number of seconds to wait for the build to finish */
const BUILD_STATUS_POLLING_MAX = 60 * 60 * MILLISECONDS;

/** Interval in seconds while polling provider */
const BUILD_POLLING_INTERVAL = 30 * MILLISECONDS;

/**
 * Allowed commit statuses that status providers may report
 */
export enum CommitStatus {
  /** Commit is still being tested/checked/etc. */
  PENDING = 'pending',
  /** All required commit checks have passed successfully */
  SUCCESS = 'success',
  /** One or more commit checks failed */
  FAILURE = 'failure',
  /** Commit could not be found */
  NOT_FOUND = 'not_found',
}

export interface StatusProviderConfig {
  name: string;

  /** Other, provider-specific config options */
  [key: string]: any;
}

/** Repository information */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface RepositoryInfo {}

/**
 * Base class for commit status providers
 */
export abstract class BaseStatusProvider {
  protected readonly logger: typeof loggerRaw;

  public constructor(
    public readonly config: StatusProviderConfig,
    public readonly githubConfig: GithubGlobalConfig
  ) {
    this.logger = loggerRaw.withScope(`[status-provider/${config.name}]`);
  }
  /**
   * Gets a status for the given revision
   *
   * @param revision Revision SHA
   */
  public abstract getRevisionStatus(revision: string): Promise<CommitStatus>;

  /**
   * Gets repository information (as seen by the provider)
   */
  public abstract getRepositoryInfo(): Promise<RepositoryInfo>;

  /**
   * Waits for the builds to finish for the revision
   *
   * @param revision Git revision SHA
   */
  public async waitForTheBuildToSucceed(revision: string): Promise<void> {
    // Status spinner
    const spinner = ora();
    const startTime = Date.now();
    let firstIteration = true;

    while (true) {
      const status = await this.getRevisionStatus(revision);
      this.logger.debug(`Got status "${status}" for revision ${revision}`);

      if (status === CommitStatus.SUCCESS) {
        if (spinner.isSpinning) {
          spinner.succeed();
        }
        this.logger.info(`Revision ${revision} has been built successfully.`);
        return;
      } else if (status === CommitStatus.FAILURE) {
        if (spinner.isSpinning) {
          spinner.fail();
        }
        reportError(
          `Build(s) for revision ${revision} have not succeeded. Please check the revision's status.`
        );
        return;
      } else if (firstIteration) {
        this.logger.info(
          status === CommitStatus.NOT_FOUND
            ? `Revision ${revision} has not been found, waiting for a bit.`
            : `Revision ${revision} has been found.`
        );
      }

      if (Date.now() - startTime > BUILD_STATUS_POLLING_MAX) {
        throw new Error(
          `Waited for more than ${BUILD_STATUS_POLLING_MAX} seconds for the build to finish. Aborting.`
        );
      }

      firstIteration = false;

      // Format as "YYYY-MM-DD hh:mm:ss"
      const timeString = new Date()
        .toISOString()
        .replace(/T/, ' ')
        .replace(/\..+/, '');
      // Update the spinner
      const waitMessage = `[${timeString}] Waiting for CI builds, next check in ${
        BUILD_POLLING_INTERVAL / 1000
      } seconds...`;
      spinner.text = waitMessage;
      if (!spinner.isSpinning) {
        spinner.start();
      }
      await sleep(BUILD_POLLING_INTERVAL);
    }
  }
}
