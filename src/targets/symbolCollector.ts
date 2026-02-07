import { BaseArtifactProvider } from '../artifact_providers/base';
import { TargetConfig, TypedTargetConfig } from '../schemas/project_config';
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

/** Config fields for symbol-collector target from .craft.yml */
interface SymbolCollectorYamlConfig extends Record<string, unknown> {
  serverEndpoint?: string;
  batchType?: string;
  bundleIdPrefix?: string;
}

export class SymbolCollector extends BaseTarget {
  /** Target name */
  public readonly name: string = 'symbol-collector';
  /** Target options */
  public readonly symbolCollectorConfig: SymbolCollectorTargetConfig;

  public constructor(
    config: TargetConfig,
    artifactProvider: BaseArtifactProvider,
  ) {
    super(config, artifactProvider);
    this.symbolCollectorConfig = this.getSymbolCollectorConfig();
  }

  private getSymbolCollectorConfig(): SymbolCollectorTargetConfig {
    // The Symbol Collector should be available in the path
    checkExecutableIsPresent(SYM_COLLECTOR_BIN_NAME);

    const config = this.config as TypedTargetConfig<SymbolCollectorYamlConfig>;
    if (!config.batchType) {
      throw new ConfigurationError(
        'The required `batchType` parameter is missing in the configuration file. ' +
          'See the documentation for more details.',
      );
    }
    if (!config.bundleIdPrefix) {
      throw new ConfigurationError(
        'The required `bundleIdPrefix` parameter is missing in the configuration file. ' +
          'See the documentation for more details.',
      );
    }

    return {
      serverEndpoint:
        config.serverEndpoint || DEFAULT_SYM_COLLECTOR_SERVER_ENDPOINT,
      batchType: config.batchType,
      bundleIdPrefix: config.bundleIdPrefix,
    };
  }

  public async publish(version: string, revision: string): Promise<any> {
    const bundleId = this.symbolCollectorConfig.bundleIdPrefix + version;
    const artifacts = await this.getArtifactsForRevision(revision, {
      includeNames: this.config.includeNames,
      excludeNames: this.config.excludeNames,
    });

    if (artifacts.length === 0) {
      this.logger.warn(`Didn't found any artifacts after filtering`);
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
          const subdirPath = join(dir, String(index));
          await fsPromises.mkdir(subdirPath);
          await this.artifactProvider.downloadArtifact(artifact, subdirPath);
        }),
      );

      const cmdOutput = await spawnProcess(SYM_COLLECTOR_BIN_NAME, [
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

      if (cmdOutput) {
        if (cmdOutput.length === 0) {
          this.logger.info(`The command didn't have any output.`);
        } else {
          this.logger.info('Command output:\n', cmdOutput.toString());
        }
      }
    });
  }
}
