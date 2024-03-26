import { TargetConfig } from '../schemas/project_config';
import {
  BaseArtifactProvider,
  RemoteArtifact,
} from '../artifact_providers/base';
import { ConfigurationError, reportError } from '../utils/errors';
import { checkExecutableIsPresent, spawnProcess } from '../utils/system';
import { BaseTarget } from './base';

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
export interface PypiTargetOptions {
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

  public constructor(
    config: TargetConfig,
    artifactProvider: BaseArtifactProvider
  ) {
    super(config, artifactProvider);
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

  async uploadAssets(paths: string[]): Promise<any> {
    // TODO: Sign the package with "--sign"
    return spawnProcess(TWINE_BIN, ['upload', ...paths]);
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
    this.logger.debug('Fetching artifact list...');
    const packageFiles = await this.getArtifactsForRevision(revision, {
      includeNames: DEFAULT_PYPI_REGEX,
    });

    if (!packageFiles.length) {
      reportError('Cannot release to PyPI: no packages found');
      return undefined;
    }

    const paths = await Promise.all(
      packageFiles.map(async (file: RemoteArtifact) => {
        this.logger.info(`Uploading file "${file.filename}" via twine`);
        return this.artifactProvider.downloadArtifact(file);
      })
    );
    await this.uploadAssets(paths);

    this.logger.info('PyPI release complete');
  }
}
