import { BaseArtifactProvider } from '../artifact_providers/base';
import { TargetConfig } from '../schemas/project_config';
import { ConfigurationError } from '../utils/errors';
import { BaseTarget } from './base';

/** Config options for the "java-symbols" target. */
interface JavaSymbolsTargetConfig {
  serverEndpoint: string;
  batchType: string;
}

export class JavaSymbols extends BaseTarget {
  /** Target name */
  public readonly name: string = 'java-symbols';
  /** Target options */
  public readonly javaSymbolsConfig: JavaSymbolsTargetConfig;

  public constructor(
    config: TargetConfig,
    artifactProvider: BaseArtifactProvider
  ) {
    super(config, artifactProvider);
    this.javaSymbolsConfig = this.getJavaSymbolsConfig();
  }

  private getJavaSymbolsConfig(): JavaSymbolsTargetConfig {
    if (!this.config.serverEndpoint || !this.config.batchType) {
      throw new ConfigurationError(
        'Required configuration not found in configuration file. ' +
          'See the documentation for more details.'
      );
    }
    return {
      serverEndpoint: this.config.serverEndpoint,
      batchType: this.config.batchType,
    };
  }

  public async publish(version: string, revision: string): Promise<any> {
    console.log(version);
    console.log(revision);
  }
}
