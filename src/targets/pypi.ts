import { Artifact } from '@zeus-ci/sdk';

import { logger as loggerRaw } from '../logger';
import { TargetConfig } from '../schemas/project_config';
import { ZeusStore } from '../stores/zeus';
import { ConfigurationError, reportError } from '../utils/errors';
import { checkExecutableIsPresent, spawnProcess } from '../utils/system';
import { BaseTarget } from './base';

const logger = loggerRaw.withScope('[pypi]');

const DEFAULT_TWINE_BIN = 'twine';

/**
 * Command to launch twine
 */
const TWINE_BIN = process.env.TWINE_BIN || DEFAULT_TWINE_BIN;

/**
 * RegExp for Python packages
 */
const DEFAULT_PYPI_REGEX = /^.*\d\.\d.*(\.whl|\.gz|\.zip)$/;

/** Options for "pypi" target */
export interface PypiTargetOptions extends TargetConfig {
  /** Twine username */
  twineUsername: string;
  /** Twine password */
  twinePassword: string;
}

/**
 * Target responsible for publishing releases on PyPI (Python package index)
 */
export class PypiTarget extends BaseTarget {
  /** Target name */
  public readonly name: string = 'pypi';
  /** Target options */
  public readonly pypiConfig: PypiTargetOptions;

  public constructor(config: any, store: ZeusStore) {
    super(config, store);
    this.pypiConfig = this.getPypiConfig();
    checkExecutableIsPresent(TWINE_BIN);
  }

  /**
   * Extracts PyPI target options from the environment
   */
  public getPypiConfig(): PypiTargetOptions {
    if (!process.env.TWINE_USERNAME || !process.env.TWINE_PASSWORD) {
      throw new ConfigurationError(
        `Cannot perform PyPI release: missing credentials.
         Please use TWINE_USERNAME and TWINE_PASSWORD environment variables.`.replace(
          /^\s+/gm,
          ''
        )
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
    const packageFiles = await this.getArtifactsForRevision(revision, {
      includeNames: DEFAULT_PYPI_REGEX,
    });

    if (!packageFiles.length) {
      reportError('Cannot release to PyPI: no packages found');
      return undefined;
    }

    await Promise.all(
      packageFiles.map(async (file: Artifact) => {
        const path = await this.store.downloadArtifact(file);
        logger.info(`Uploading file "${file.name}" via twine`);
        return this.uploadAsset(path);
      })
    );

    logger.info('PyPI release complete');
  }
}
