import * as ora from 'ora';

import { sleepAsync } from '../utils/system';

import { reportError } from '../utils/errors';

import { logger } from '../logger';

/** Max number of seconds to wait for the build to finish */
const BUILD_STATUS_POLLING_MAX = 60 * 60;

/** Interval in seconds while polling provider */
const BUILD_POLLING_INTERVAL = 30;

/**
 * TODO
 */
export enum CommitStatus {
  /** TODO */
  PENDING = 'pending',
  /** TODO */
  SUCCESS = 'success',
  /** TODO */
  FAILURE = 'failure',
  /** TODO */
  NOT_FOUND = 'not_found',
}

/**
 * Base class for commit status providers
 */
export abstract class BaseStatusProvider {
  public config: any;

  /** TODO */
  public abstract async getRevisionStatus(
    revision: string
  ): Promise<CommitStatus>;

  /** TODO */
  public abstract async getRepositoryInfo(): Promise<any>;

  /**
   * Waits for the builds to finish for the revision
   *
   * @param revision Git revision SHA
   */
  public async waitForTheBuildToSucceed(revision: string): Promise<void> {
    // Status spinner
    const spinner = ora({ spinner: 'bouncingBar' }) as any;
    let secondsPassed = 0;
    let firstIteration = true;
    while (true) {
      const status = await this.getRevisionStatus(revision);

      // tslint:disable-next-line:prefer-switch
      if (status === CommitStatus.SUCCESS) {
        if (spinner.isSpinning) {
          spinner.succeed();
        }
        logger.info(`Revision ${revision} has been built successfully.`);
        return;
      } else if (status === CommitStatus.FAILURE) {
        if (spinner.isSpinning) {
          spinner.fail();
        }
        reportError(
          `Build(s) for revision ${revision} have failed. Please check the revision's status.`
        );
        return;
      } else if (status === CommitStatus.NOT_FOUND) {
        if (firstIteration) {
          logger.info(
            `Revision ${revision} has not been found, waiting for a bit.`
          );
        }
      }

      if (firstIteration) {
        firstIteration = false;
        if (status !== CommitStatus.NOT_FOUND) {
          logger.info(`Revision ${revision} has been found.`);
        }
      }

      if (secondsPassed > BUILD_STATUS_POLLING_MAX) {
        throw new Error(
          `Waited for more than ${BUILD_STATUS_POLLING_MAX} seconds for the build to finish. Aborting.`
        );
      }

      // Update the spinner
      const timeString = new Date().toLocaleString();
      const waitMessage = `[${timeString}] CI builds are still in progress, sleeping for ${BUILD_POLLING_INTERVAL} seconds...`;
      spinner.text = waitMessage;
      spinner.start();
      await sleepAsync(BUILD_POLLING_INTERVAL * 1000);
      secondsPassed += BUILD_POLLING_INTERVAL;
    }
  }
}
