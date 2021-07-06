import { checkEnvForPrerequisite } from '../utils/env';
import { stringToRegexp } from '../utils/filters';
import { BaseArtifactProvider } from '../artifact_providers/base';
import { TargetConfig } from '../schemas/project_config';
import { ConfigurationError } from '../utils/errors';
import { BaseTarget } from './base';
import { withTempDir } from '../utils/files';
import { promises as fsPromises } from 'fs';
import { spawnProcess } from '../utils/system';
import { GithubRemote } from '../utils/githubApi';

/** Config options for the "java-symbols" target. */
interface JavaSymbolsTargetConfig {
  serverEndpoint: string;
  batchType: string;
  bundleIdPrefix: string;
  useLatestSymCollectorRelease: boolean;
  releaseTag: string;
  symCollectorAssetName: string;
  binaryName: string;
}

export class JavaSymbols extends BaseTarget {
  /** Target name */
  public readonly name: string = 'java-symbols';
  /** Target options */
  public readonly javaSymbolsConfig: JavaSymbolsTargetConfig;

  public readonly github: GithubRemote;

  public constructor(
    config: TargetConfig,
    artifactProvider: BaseArtifactProvider
  ) {
    super(config, artifactProvider);
    // TODO: don't hardcode repo's data
    this.github = new GithubRemote('getsentry', 'symbol-collector');
    this.javaSymbolsConfig = this.getJavaSymbolsConfig();
  }

  private getJavaSymbolsConfig(): JavaSymbolsTargetConfig {
    checkEnvForPrerequisite({ name: 'SYMBOL_COLLECTOR_PATH' });

    if (
      !this.config.serverEndpoint ||
      !this.config.batchType ||
      !this.config.bundleIdPrefix
    ) {
      throw new ConfigurationError(
        'Required configuration not found in configuration file. ' +
          'See the documentation for more details.'
      );
    }

    return {
      serverEndpoint: this.config.serverEndpoint,
      batchType: this.config.batchType,
      bundleIdPrefix: this.config.bundleIdPrefix,
      // TODO: read config params below from the config file
      useLatestSymCollectorRelease: true,
      releaseTag: '1.3.1',
      symCollectorAssetName: 'symbolcollector-console-linux-x64.zip',
      binaryName: 'SymbolCollector.Console',
    };
  }

  public async publish(version: string, revision: string): Promise<any> {
    const bundleId = this.javaSymbolsConfig.bundleIdPrefix + `${version}`;

    const artifacts = await this.getArtifactsForRevision(revision, {
      includeNames:
        this.config.includeNames === undefined
          ? undefined
          : stringToRegexp(this.config.includeNames),
    });

    await withTempDir(async dir => {
      // Download all artifacts in the same parent directory, where the symbol
      // collector will look for and deal with them.
      // Do it in different subdirectories, since some files have the same name.
      artifacts.map(async (artifact, index) => {
        const subdirPath = dir + '/' + index;
        await fsPromises.mkdir(subdirPath);
        this.artifactProvider.downloadArtifact(artifact, subdirPath);
      });
      spawnProcess(this.javaSymbolsConfig.symbolCollectorPath, [
        '--upload',
        'directory',
        '--path',
        dir,
        '--batch-type',
        this.javaSymbolsConfig.batchType,
        '--bundle-id',
        bundleId,
        '--server-endpoint',
        this.javaSymbolsConfig.serverEndpoint,
      ]);
    });
  }
}
