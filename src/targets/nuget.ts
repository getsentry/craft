import { logger as loggerRaw } from '../logger';
import { TargetConfig } from '../schemas/project_config';
import { ConfigurationError, reportError } from '../utils/errors';
import { checkExecutableIsPresent, spawnProcess } from '../utils/system';
import { BaseTarget } from './base';
import {
  BaseArtifactProvider,
  RemoteArtifact,
} from '../artifact_providers/base';

const logger = loggerRaw.withScope('[nuget]');

/** Command to launch dotnet tools */
export const NUGET_DOTNET_BIN = process.env.NUGET_DOTNET_BIN || 'dotnet';

/** Default Nuget registry URL */
export const DEFAULT_NUGET_SERVER_URL = 'https://api.nuget.org/v3/index.json';

/** A regular expression used to find the package tarball */
const DEFAULT_NUGET_REGEX = /^.*\d\.\d.*\.nupkg$/;

/** Nuget target configuration options */
export interface NugetTargetOptions extends TargetConfig {
  /** Nuget API token */
  apiToken: string;
  /** Nuget server URL */
  serverUrl: string;
}

/**
 * Target responsible for publishing releases on Nuget
 */
export class NugetTarget extends BaseTarget {
  /** Target name */
  public readonly name: string = 'nuget';
  /** Target options */
  public readonly nugetConfig: NugetTargetOptions;

  public constructor(config: any, artifactProvider: BaseArtifactProvider) {
    super(config, artifactProvider);
    this.nugetConfig = this.getNugetConfig();
    checkExecutableIsPresent(NUGET_DOTNET_BIN);
  }

  /**
   * Extracts Nuget target options from the raw configuration
   */
  protected getNugetConfig(): NugetTargetOptions {
    if (!process.env.NUGET_API_TOKEN) {
      throw new ConfigurationError(
        `Cannot perform Nuget release: missing credentials.
         Please use NUGET_API_TOKEN environment variable.`
      );
    }
    return {
      apiToken: process.env.NUGET_API_TOKEN,
      serverUrl: this.config.serverUrl || DEFAULT_NUGET_SERVER_URL,
    };
  }

  /**
   * Uploads an archive to Nuget using "dotnet nuget"
   *
   * @param path Absolute path to the archive to upload
   * @returns A promise that resolves when the upload has completed
   */
  public async uploadAsset(path: string): Promise<any> {
    return spawnProcess(NUGET_DOTNET_BIN, [
      'nuget',
      'push',
      path,
      '--api-key',
      '${NUGET_API_TOKEN}',
      '--source',
      this.nugetConfig.serverUrl,
    ]);
  }

  /**
   * Publishes a package tarball to the Nuget registry
   *
   * @param version New version to be released
   * @param revision Git commit SHA to be published
   */
  public async publish(_version: string, revision: string): Promise<any> {
    logger.debug('Fetching artifact list...');
    const packageFiles = await this.getArtifactsForRevision(revision, {
      includeNames: DEFAULT_NUGET_REGEX,
    });

    if (!packageFiles.length) {
      reportError(
        'Cannot release to Nuget: there are no Nuget packages found!'
      );
    }

    await Promise.all(
      packageFiles.map(async (file: RemoteArtifact) => {
        const path = await this.artifactProvider.downloadArtifact(file);
        logger.info(`Uploading file "${file.filename}" via "dotnet nuget"`);
        return this.uploadAsset(path);
      })
    );

    logger.info('Nuget release complete');
  }
}
