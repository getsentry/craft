import * as ora from 'ora';

import { sleepAsync } from '../utils/system';

import { reportError } from '../utils/errors';

import { logger } from '../logger';
// import { TargetConfig } from '../schemas/project_config';
// import { stringToRegexp } from '../utils/filters';

/** Max number of seconds to wait for revision to be available */
const REVISION_INFO_POLLING_MAX = 60 * 10;

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
}

// /**
//  * TODO
//  */
// interface CraftArtifact {
//   yo: string;
// }

/**
 * Base class for commit status providers
 */
export abstract class BaseStatusProvider {
  /** TODO */
  public abstract async getRevisionStatus(
    revision: string
  ): Promise<CommitStatus>;

  /** TODO */
  public abstract async getRepositoryInfo(): Promise<any>;

  /**
   * Fetches revision information from the status provider
   *
   * If the revision is not found in status provider, the function polls for it regularly.
   *
   * @param revision Git revision SHA
   */
  public async pollRevisionStatus(revision: string): Promise<CommitStatus> {
    const spinner = ora({ spinner: 'bouncingBar' }) as any;

    let secondsPassed = 0;

    while (true) {
      try {
        const revisionInfo = await this.getRevisionStatus(revision);
        if (spinner.isSpinning) {
          spinner.succeed();
        }
        return revisionInfo;
      } catch (e) {
        const errorMessage: string = e.message || '';
        if (!errorMessage.match(/404 not found|resource not found/i)) {
          if (spinner.isSpinning) {
            spinner.fail();
          }
          throw e;
        }

        if (secondsPassed > REVISION_INFO_POLLING_MAX) {
          throw new Error(
            `Waited for more than ${REVISION_INFO_POLLING_MAX} seconds, and the revision is still not available. Aborting.`
          );
        }

        // Update the spinner
        const timeString = new Date().toLocaleString();
        const waitMessage = `[${timeString}] Revision ${revision} is not yet found in status provider, retrying in ${BUILD_POLLING_INTERVAL} seconds...`;
        spinner.text = waitMessage;
        spinner.start();
        await sleepAsync(BUILD_POLLING_INTERVAL * 1000);
        secondsPassed += BUILD_POLLING_INTERVAL;
      }
    }
  }

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

      if (firstIteration) {
        logger.info(`Revision ${revision} has been found.`);
        firstIteration = false;
      }

      if (status === CommitStatus.SUCCESS) {
        if (spinner.isSpinning) {
          spinner.succeed();
        }
        logger.info(`Revision ${revision} has been built successfully.`);
        return;
      }

      if (status === CommitStatus.FAILURE) {
        if (spinner.isSpinning) {
          spinner.fail();
        }
        reportError(
          `Build(s) for revision ${revision} have failed. Please check the revision's status.`
        );
        return;
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

// export class GithubStatusProvider extends BaseStatusProvider {
//   getRevisionStatus(revision: string): CommitStatus {
//     logger.info(revision);
//     return CommitStatus.PENDING;
//   }
// }

////////////////////////////////////////////////////

// export abstract class BaseArtifactProvider {
//   abstract async listArtifactsForRevision(
//     revision: string
//   ): Promise<CraftArtifact[]>;

//   abstract async downloadArtifact(artifact: CraftArtifact): Promise<string>;

//   public async downloadArtifacts(
//     artifacts: CraftArtifact[]
//   ): Promise<string[]> {
//     return Promise.all(
//       artifacts.map(async artifact => this.downloadArtifact(artifact))
//     );
//   }
// }
