import { stringToRegexp } from '../utils/filters';
import { BaseArtifactProvider } from '../artifact_providers/base';
import { TargetConfig } from '../schemas/project_config';
import { ConfigurationError, reportError } from '../utils/errors';
import { BaseTarget } from './base';
import { withTempDir } from '../utils/files';
import { promises as fsPromises } from 'fs';
import {
  extractZipArchive,
  makeExecutable,
  spawnProcess,
} from '../utils/system';
import { join } from 'path';
import { GithubRemote } from '../utils/githubApi';

const DEFAULT_SYM_COLLECTOR_SERVER_ENDPOINT =
  'https://symbol-collector.services.sentry.io/';
const DEFAULT_SYM_COLLECTOR_ASSET_NAME =
  'symbolcollector-console-linux-x64.zip';
const DEFAULT_SYM_COLLECTOR_FILENAME = 'SymbolCollector.Console';

/** Config options for the "native-symbols" target. */
interface NativeSymbolsTargetConfig {
  /** Server endpoint to upload symbols. */
  serverEndpoint: string;
  /** batch-type of the symbols to be uploaded. */
  batchType: string;
  /** Prefix of the bundle ID to be uploaded. */
  bundleIdPrefix: string;
  /** Whether to use the latest Symbol Collector release. */
  useLatestSymCollectorRelease: boolean;
  /** Tag of the release of the Symbol Collector that should be used. */
  releaseTag: string;
  /**
   * Name of the asset in the release where the Symbol Collector
   * binary should be found.
   */
  symCollectorAssetName: string;
  /** Name of the Symbol Collector binary, inside the asset. */
  binaryName: string;
}

export class NativeSymbols extends BaseTarget {
  /** Target name */
  public readonly name: string = 'native-symbols';
  /** Target options */
  public readonly nativeSymbolsConfig: NativeSymbolsTargetConfig;

  public readonly github: GithubRemote;

  public constructor(
    config: TargetConfig,
    artifactProvider: BaseArtifactProvider
  ) {
    super(config, artifactProvider);
    // TODO: don't hardcode repo's data
    this.github = new GithubRemote('getsentry', 'symbol-collector');
    this.nativeSymbolsConfig = this.getNativeSymbolsConfig();
  }

  private getNativeSymbolsConfig(): NativeSymbolsTargetConfig {
    if (
      !this.config.batchType ||
      !this.config.bundleIdPrefix ||
      !(this.config.useLatestSymCollectorRelease || this.config.releaseTag)
    ) {
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
      useLatestSymCollectorRelease: this.config.useLatestSymCollectorRelease,
      releaseTag: this.config.releaseTag,
      symCollectorAssetName: DEFAULT_SYM_COLLECTOR_ASSET_NAME,
      binaryName: this.config.binaryName || DEFAULT_SYM_COLLECTOR_FILENAME,
    };
  }

  public async publish(version: string, revision: string): Promise<any> {
    const bundleId = this.nativeSymbolsConfig.bundleIdPrefix + `${version}`;
    this.logger.debug('Fetching artifacts...');
    const artifacts = await this.getArtifactsForRevision(revision, {
      includeNames:
        this.config.includeNames === undefined
          ? undefined
          : stringToRegexp(this.config.includeNames),
    });
    this.logger.debug(`Found ${artifacts.length} symbol artifacts.`);

    await withTempDir(async dir => {
      const collectorDir = join(dir, 'collector');
      await fsPromises.mkdir(collectorDir);
      const symbolCollectorPath = await this.downloadSymbolCollector(
        collectorDir
      );

      const symbolsPath = join(dir, 'symbols');
      await fsPromises.mkdir(symbolsPath);

      // Download all artifacts in the same parent directory, where the symbol
      // collector will recursively look for and deal with them.
      // Since there are files with the same name, download them in different
      // directories.
      this.logger.debug('Downloading artifacts...');
      await Promise.all(
        artifacts.map(async (artifact, index) => {
          const subdirPath = join(symbolsPath, index + '');
          await fsPromises.mkdir(subdirPath);
          await this.artifactProvider.downloadArtifact(artifact, subdirPath);
        })
      );

      await spawnProcess(symbolCollectorPath, [
        '--upload',
        'directory',
        '--path',
        symbolsPath,
        '--batch-type',
        this.nativeSymbolsConfig.batchType,
        '--bundle-id',
        bundleId,
        '--server-endpoint',
        this.nativeSymbolsConfig.serverEndpoint,
      ]);
    });
  }

  private async downloadSymbolCollector(dir: string): Promise<string> {
    // Currently, GitHub doesn't offer an API to download the asset of a
    // release by its name, and the asset ID must be provided. The workaround
    // is to get the release ID where the assets are and look for all the assets
    // until there's one matching the name to get its ID
    const assetDownloadId = await this.getAssetDownloadId();
    const assetDstPath = await this.downloadAsset(assetDownloadId, dir);
    this.logger.debug('Extracting asset...');
    await extractZipArchive(assetDstPath, dir);

    const binaryPath = join(dir, this.nativeSymbolsConfig.binaryName);
    this.makeBinaryExecutable(binaryPath);
    return binaryPath;
  }

  private async getAssetDownloadId(): Promise<number> {
    const releaseId = await this.getReleaseId();
    this.logger.debug('Fetching release assets...');
    const releaseAssets = await this.github.listReleaseAssets(releaseId);
    const matchingAssets = releaseAssets.filter(
      asset => asset.name === this.nativeSymbolsConfig.symCollectorAssetName
    );
    if (matchingAssets.length != 1) {
      reportError(`Found ${matchingAssets.length} assets, 1 expected.`);
    }
    const assetId = matchingAssets[0].id;
    this.logger.debug('Found asset to download: ', assetId);
    return assetId;
  }

  private async getReleaseId(): Promise<number> {
    this.logger.debug('Fetching the release...');
    const targetRelease = this.nativeSymbolsConfig.useLatestSymCollectorRelease
      ? await this.github.getLatestRelease()
      : await this.github.getReleaseByTag(this.nativeSymbolsConfig.releaseTag);
    this.logger.debug('Fetched release: ', targetRelease.id);
    return targetRelease.id;
  }

  private async downloadAsset(assetId: number, dir: string): Promise<string> {
    this.logger.debug('Fetching the asset to download...');
    const assetDataBuffer = await this.github.getAsset(assetId);
    const assetDstPath = join(
      dir,
      this.nativeSymbolsConfig.symCollectorAssetName
    );
    this.logger.debug('Downloading asset to: ', assetDstPath);
    await fsPromises.appendFile(assetDstPath, Buffer.from(assetDataBuffer));
    return assetDstPath;
  }

  private makeBinaryExecutable(binaryPath: string): void {
    const isExecutablePresent = makeExecutable(binaryPath);
    if (!isExecutablePresent) {
      throw new ConfigurationError(
        'Cannot access to the binary declared in the config file: ' + binaryPath
      );
    }
  }
}
