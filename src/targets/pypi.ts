import { extname } from 'path';

import { Artifact } from '@zeus-ci/sdk';

import logger from '../logger';
import { ZeusStore } from '../stores/zeus';
import { spawnProcess } from '../utils/system';
import { BaseTarget } from './base';

/**
 * Command to launch twine
 */
const TWINE_BIN = process.env.TWINE_BIN || 'twine';

/**
 * White list for file extensions uploaded to PyPI
 */
const PYPI_EXTENSIONS = ['.whl', '.gz', '.zip'];

export interface PypiTargetOptions {
  twineUsername: string;
  twinePassword: string;
}

export class PypiTarget extends BaseTarget {
  /** Target name */
  public readonly name: string = 'pypi';
  /** Target options */
  public readonly pypiConfig: PypiTargetOptions;

  public constructor(config: any, store: ZeusStore) {
    super(config, store);
    this.pypiConfig = this.getPypiConfig();
  }

  public getPypiConfig(): PypiTargetOptions {
    if (!process.env.TWINE_USERNAME || !process.env.TWINE_PASSWORD) {
      throw new Error(
        `Cannot perform PyPI release: missing credentials.
         Please use TWINE_USERNAME and TWINE_PASSWORD environment variables.`
      );
    }
    return {
      twinePassword: process.env.TWINE_PASSWORD,
      twineUsername: process.env.TWINE_USERNAME,
    };
  }

  /**
   * Uploads an archive to PyPI using twine
   *
   * @param path Absolute path to the archive to upload
   * @returns A promise that resolves when the upload has completed
   */
  public async uploadAsset(path: string): Promise<any> {
    // TODO: Sign the package with "--sign"
    return spawnProcess(TWINE_BIN, ['upload', path]);
  }

  /**
   * Uploads all files to PyPI using Twine
   *
   * Requires twine to be configured in the environment (either beforehand or
   * via enviroment).
   *
   * @param version New version to be released
   * @param revision Git commit SHA to be published
   */
  public async publish(_version: string, revision: string): Promise<any> {
    logger.debug('Fetching artifact list from Zeus...');
    const files = await this.store.listArtifactsForRevision(revision);
    const packageFiles = files.filter(
      file => PYPI_EXTENSIONS.indexOf(extname(file.name)) > -1
    );

    if (!packageFiles.length) {
      logger.warn('Skipping PyPI release: no packages found');
      return undefined;
    }

    await Promise.all(
      packageFiles.map(async (file: Artifact) => {
        const path = await this.store.downloadArtifact(file);
        logger.info(`Uploading file "${file.name}" via twine`);
        return this.uploadAsset(path);
      })
    );

    logger.info('PyPI release completed');
  }
}
