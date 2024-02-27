import { join } from 'path';
import { BaseArtifactProvider } from '../artifact_providers/base';
import { TargetConfig } from '../schemas/project_config';
import { ConfigurationError, reportError } from '../utils/errors';
import { withTempDir } from '../utils/files';
import { isDryRun } from '../utils/helpers';
import { SpawnProcessOptions, checkExecutableIsPresent, extractZipArchive, spawnProcess } from '../utils/system';
import { BaseTarget } from './base';

/** Command to launch PowerShell */
export const POWERSHELL_BIN = process.env.POWERSHELL_BIN || 'pwsh';

/** Default repository */
export const DEFAULT_POWERSHELL_REPOSITORY = 'PSGallery';

/** PowerShell target configuration options */
export interface PowerShellTargetOptions {
  /** API token */
  apiKey: string;
  /** PowerShell repository name */
  repository: string;
  /** Module name */
  module: string;
}

/**
 * Target responsible for publishing modules to a PowerShell repository
 */
export class PowerShellTarget extends BaseTarget {
  /** Target name */
  public readonly name: string = 'powershell';
  /** Target options */
  public readonly psConfig: PowerShellTargetOptions;

  public constructor(
    config: TargetConfig,
    artifactProvider: BaseArtifactProvider
  ) {
    super(config, artifactProvider);
    this.psConfig = this.getPowerShellConfig();
    checkExecutableIsPresent(POWERSHELL_BIN);
  }

  /**
   * Extracts target options from the raw configuration
   */
  protected getPowerShellConfig(): PowerShellTargetOptions {
    if (!process.env.POWERSHELL_API_KEY) {
      throw new ConfigurationError(
        `Cannot perform PowerShell release: missing credentials.
         Please use POWERSHELL_API_KEY environment variable.`
      );
    }
    return {
      apiKey: process.env.POWERSHELL_API_KEY,
      repository: this.config.repository || DEFAULT_POWERSHELL_REPOSITORY,
      module: this.config.module,
    };
  }
  /**
     * Executes a PowerShell command.
     */
  private async spawnPwsh(
    command: string,
    spawnProcessOptions: SpawnProcessOptions = {}
  ): Promise<Buffer | undefined> {
    command = `$ErrorActionPreference = 'Stop'\n` + command;
    this.logger.trace("Executing PowerShell command:", command);
    return spawnProcess(POWERSHELL_BIN, ['-Command', command], {}, spawnProcessOptions);
  }

  /**
   * Publishes a package tarball to the PowerShell repository
   *
   * @param version New version to be released
   * @param revision Git commit SHA to be published
   */
  public async publish(_version: string, revision: string): Promise<any> {
    const defaultSpawnOptions = { enableInDryRunMode: true, showStdout: true }
    // Emit the PowerShell executable for informational purposes.
    this.logger.info(`PowerShell (${POWERSHELL_BIN}) info:`);
    await spawnProcess(POWERSHELL_BIN, ['--version'], {}, defaultSpawnOptions);

    // Also check the command and its its module version in case there are issues:
    this.logger.info('Publish-Module command info:');
    await this.spawnPwsh(`
      $info = Get-Command -Name Publish-Module
      "Module name: $($info.ModuleName)"
      "Module version: $($info.Module.Version)"
      "Module path: $($info.Module.Path)"
    `, defaultSpawnOptions);

    // Escape the given module artifact name to avoid regex issues.
    let moduleArtifactRegex = `${this.psConfig.module}`.replace(/[/\-\\^$*+?.()|[\]{}]/g, '\\$&');
    moduleArtifactRegex = `/^${moduleArtifactRegex}\\.zip$/`

    this.logger.debug(`Looking for artifact matching ${moduleArtifactRegex}`);
    const packageFiles = await this.getArtifactsForRevision(revision, {
      includeNames: moduleArtifactRegex,
    });
    if (!packageFiles.length) {
      reportError(
        `Cannot release the module to ${this.psConfig.repository}: there are no matching artifacts!`
      );
    } else if (packageFiles.length > 1) {
      reportError(
        `Cannot release the module to ${this.psConfig.repository}: found multiple matching artifacts!`
      );
    }
    const artifact = packageFiles[0];
    const zipPath = await this.artifactProvider.downloadArtifact(artifact);

    this.logger.info(`Extracting artifact "${artifact.filename}"`)
    await withTempDir(async dir => {
      const moduleDir = join(dir, this.psConfig.module);
      await extractZipArchive(zipPath, moduleDir);

      this.logger.info(`Publishing PowerShell module "${this.psConfig.module}" to ${this.psConfig.repository}`)
      await this.spawnPwsh(`
        Publish-Module  -Path '${moduleDir}' \`
                        -Repository ${this.psConfig.repository} \`
                        -NuGetApiKey ${this.psConfig.apiKey} \`
                        -WhatIf:$${isDryRun()}
      `, defaultSpawnOptions)
    });

    this.logger.info(`PowerShell module upload complete: $`);
  }
}
