import { stringToRegexp } from '../utils/filters';
import { BaseArtifactProvider } from '../artifact_providers/base';
import { TargetConfig } from '../schemas/project_config';
import { ConfigurationError } from '../utils/errors';
import { BaseTarget } from './base';
import { withTempDir } from '../utils/files';
import { promises as fsPromises } from 'fs';
import { checkExecutableIsPresent, spawnProcess } from '../utils/system';
import { join } from 'path';

const DEFAULT_SYM_COLLECTOR_SERVER_ENDPOINT =
  'https://symbol-collector.services.sentry.io/';
/**
 * Name of the binary of the symbol collector.
 * Must be available in the path.
 */
export const SYM_COLLECTOR_BIN_NAME = 'SymbolCollector.Console';

/** Config options for the "symbol-collector" target. */
interface SymbolCollectorTargetConfig {
  /** Server endpoint to upload symbols. */
  serverEndpoint: string;
  /** batch-type of the symbols to be uploaded. */
  batchType: string;
  /** Prefix of the bundle ID to be uploaded. */
  bundleIdPrefix: string;
}

export class SymbolCollector extends BaseTarget {
  /** Target name */
  public readonly name: string = 'symbol-collector';
  /** Target options */
  public readonly symbolCollectorConfig: SymbolCollectorTargetConfig;

  public constructor(
    config: TargetConfig,
    artifactProvider: BaseArtifactProvider
  ) {
    super(config, artifactProvider);
    this.symbolCollectorConfig = this.getSymbolCollectorConfig();
  }

  private getSymbolCollectorConfig(): SymbolCollectorTargetConfig {
    // The Symbol Collector should be available in the path
    checkExecutableIsPresent(SYM_COLLECTOR_BIN_NAME);

    if (!this.config.batchType || !this.config.bundleIdPrefix) {
      throw new ConfigurationError(
        'Required configuration not found in configuration file. ' +
          'See the documentation for more details.'
      );
    }

    return {
      serverEndpoint:
        this.config.serverEndpoint || DEFAULT_SYM_COLLECTOR_SERVER_ENDPOINT,
      batchType: this.config.batchType,
      bundleIdPrefix: this.config.bundleIdPrefix,
    };
  }

  public async publish(version: string, revision: string): Promise<any> {
    const bundleId = this.symbolCollectorConfig.bundleIdPrefix + `${version}`;
    this.logger.debug('Fetching artifacts...');
    const artifacts = await this.getArtifactsForRevision(revision, {
      includeNames:
        this.config.includeNames === undefined
          ? undefined
          : stringToRegexp(this.config.includeNames),
    });

    if (artifacts.length == 0) {
      this.logger.info(`Didn't found any artifacts after filtering`);
      return;
    }

    this.logger.debug(`Found ${artifacts.length} symbol artifacts.`);

    await withTempDir(async dir => {
      // Download all artifacts in the same parent directory, where the symbol
      // collector will recursively look for and deal with them.
      // Since there are files with the same name, download them in different
      // directories.
      this.logger.debug('Downloading artifacts...');
      await Promise.all(
        artifacts.map(async (artifact, index) => {
          const subdirPath = join(dir, index + '');
          await fsPromises.mkdir(subdirPath);
          await this.artifactProvider.downloadArtifact(artifact, subdirPath);
        })
      );

      await spawnProcess(SYM_COLLECTOR_BIN_NAME, [
        '--upload',
        'directory',
        '--path',
        dir,
        '--batch-type',
        this.symbolCollectorConfig.batchType,
        '--bundle-id',
        bundleId,
        '--server-endpoint',
        this.symbolCollectorConfig.serverEndpoint,
      ]);
    });
  }
}
