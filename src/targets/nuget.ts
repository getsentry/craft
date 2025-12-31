import pLimit from 'p-limit';

import { TargetConfig } from '../schemas/project_config';
import { ConfigurationError, reportError } from '../utils/errors';
import { stringToRegexp } from '../utils/filters';
import { checkExecutableIsPresent, spawnProcess } from '../utils/system';
import { BaseTarget } from './base';
import {
  BaseArtifactProvider,
  RemoteArtifact,
} from '../artifact_providers/base';
import {
  discoverDotnetPackages,
  sortDotnetPackages,
  packageIdToNugetArtifactPattern,
  packageIdToNugetArtifactFromTemplate,
} from '../utils/dotnetWorkspaces';
import { filterWorkspacePackages } from '../utils/workspaces';
import { logger } from '../logger';

/** Command to launch dotnet tools */
export const NUGET_DOTNET_BIN = process.env.NUGET_DOTNET_BIN || 'dotnet';

/** Default Nuget registry URL */
export const DEFAULT_NUGET_SERVER_URL = 'https://api.nuget.org/v3/index.json';

/** A regular expression used to find the package tarball */
const DEFAULT_NUGET_REGEX = /^.*\d\.\d.*\.nupkg$/;
const SYMBOLS_NUGET_REGEX = /^.*\d\.\d.*\.snupkg$/;

/**
 * Spawn options to run dotnet commands outside the repository folder to avoid global.json constraints
 * (we don't need specific dotnet/workload versions just to upload to nuget)
 */
const DOTNET_SPAWN_OPTIONS = { cwd: '/' };

/** Extended NuGet target configuration with workspace options */
export interface NugetTargetConfig extends TargetConfig {
  /**
   * Enable workspace discovery to auto-generate nuget targets for all packages.
   * When enabled, this target will be expanded into multiple targets, one per NuGet package.
   */
  workspaces?: boolean;
  /**
   * Path to the solution file (.sln) relative to the repository root.
   * If not specified, auto-discovers the first .sln file in the root directory.
   */
  solutionPath?: string;
  /**
   * Regex pattern to filter which packages to include.
   * Only packages with IDs matching this pattern will be published.
   * Example: '/^Sentry\\./'
   */
  includeWorkspaces?: string;
  /**
   * Regex pattern to filter which packages to exclude.
   * Packages with IDs matching this pattern will not be published.
   * Example: '/\\.Tests$/'
   */
  excludeWorkspaces?: string;
  /**
   * Template for generating artifact filenames from package IDs.
   * Variables: {{packageId}}, {{version}}
   * Default convention: Sentry.Core -> Sentry.Core.{version}.nupkg
   */
  artifactTemplate?: string;
  /** NuGet server URL */
  serverUrl?: string;
}

/** Nuget target configuration options */
export interface NugetTargetOptions {
  /** Nuget API token */
  apiToken: string;
  /** Nuget server URL */
  serverUrl: string;
}

/**
 * Target responsible for publishing releases on Nuget
 */
export class NugetTarget extends BaseTarget {
  public readonly name: string = 'nuget';
  public readonly nugetConfig: NugetTargetOptions;

  /**
   * Expand a nuget target config into multiple targets if workspaces is enabled.
   */
  public static async expand(
    config: NugetTargetConfig,
    rootDir: string
  ): Promise<TargetConfig[]> {
    if (!config.workspaces) {
      return [config];
    }

    const result = await discoverDotnetPackages(rootDir, config.solutionPath);

    if (!result || result.packages.length === 0) {
      logger.warn(
        'nuget target has workspaces enabled but no packable projects were found'
      );
      return [];
    }

    const workspacePackages = result.packages.map(pkg => ({
      name: pkg.packageId,
      location: pkg.projectPath,
      private: !pkg.isPackable,
      hasPublicAccess: true,
      workspaceDependencies: pkg.projectDependencies,
    }));

    let includePattern: RegExp | undefined;
    let excludePattern: RegExp | undefined;

    if (config.includeWorkspaces) {
      includePattern = stringToRegexp(config.includeWorkspaces);
    }
    if (config.excludeWorkspaces) {
      excludePattern = stringToRegexp(config.excludeWorkspaces);
    }

    const filteredWorkspacePackages = filterWorkspacePackages(
      workspacePackages,
      includePattern,
      excludePattern
    );

    if (filteredWorkspacePackages.length === 0) {
      logger.warn('No publishable NuGet packages found after filtering');
      return [];
    }

    const filteredNames = new Set(filteredWorkspacePackages.map(p => p.name));
    const filteredPackages = result.packages.filter(p =>
      filteredNames.has(p.packageId)
    );

    const sortedPackages = sortDotnetPackages(filteredPackages);

    logger.info(
      `Discovered ${sortedPackages.length} publishable NuGet packages from ${result.solutionPath}`
    );
    logger.debug(
      `Expanding nuget workspace target to ${
        sortedPackages.length
      } packages (dependency order): ${sortedPackages
        .map(p => p.packageId)
        .join(', ')}`
    );

    return sortedPackages.map(pkg => {
      let includeNames: string;
      if (config.artifactTemplate) {
        includeNames = packageIdToNugetArtifactFromTemplate(
          pkg.packageId,
          config.artifactTemplate
        );
      } else {
        includeNames = packageIdToNugetArtifactPattern(pkg.packageId);
      }

      const expandedTarget: TargetConfig = {
        name: 'nuget',
        id: pkg.packageId,
        includeNames,
      };

      if (config.excludeNames) {
        expandedTarget.excludeNames = config.excludeNames;
      }
      if (config.serverUrl) {
        expandedTarget.serverUrl = config.serverUrl;
      }

      return expandedTarget;
    });
  }

  public constructor(
    config: NugetTargetConfig,
    artifactProvider: BaseArtifactProvider
  ) {
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
   */
  public async uploadAsset(path: string): Promise<any> {
    const args = [
      'nuget',
      'push',
      path,
      '--api-key',
      '${NUGET_API_TOKEN}',
      '--source',
      this.nugetConfig.serverUrl,
    ];
    return spawnProcess(NUGET_DOTNET_BIN, args, DOTNET_SPAWN_OPTIONS);
  }

  /**
   * Publishes a package tarball to the Nuget registry
   */
  public async publish(_version: string, revision: string): Promise<any> {
    this.logger.debug('Fetching artifact list...');
    const packageFiles = await this.getArtifactsForRevision(revision, {
      includeNames: DEFAULT_NUGET_REGEX,
    });
    const symbolFiles = await this.getArtifactsForRevision(revision, {
      includeNames: SYMBOLS_NUGET_REGEX,
    });

    if (!packageFiles.length) {
      reportError(
        'Cannot release to Nuget: there are no Nuget packages found!'
      );
    }

    this.logger.info('.NET Version:');
    await spawnProcess(NUGET_DOTNET_BIN, ['--version'], DOTNET_SPAWN_OPTIONS);

    // Works around a bug: https://github.com/NuGet/Home/issues/12159#issuecomment-1278360511
    this.logger.info('Nuget Version:');
    await spawnProcess(
      NUGET_DOTNET_BIN,
      ['nuget', '--version'],
      DOTNET_SPAWN_OPTIONS
    );

    // Publish packages with limited concurrency to avoid overwhelming NuGet.org
    // while still being faster than fully sequential publishing.
    // When using workspace expansion, packages are already sorted in dependency order.
    const limit = pLimit(3);

    await Promise.all(
      packageFiles.map((file: RemoteArtifact) =>
        limit(async () => {
          const path = await this.artifactProvider.downloadArtifact(file);

          // If an artifact containing a .snupkg file exists with the same base
          // name as the .nupkg file, then download it to the same location.
          // It will be picked up automatically when pushing the .nupkg.

          // Note, this approach is required vs sending them separately, because
          // we need to send the .nupkg *first*, and it must succeed before the
          // .snupkg is sent.

          const symbolFileName = file.filename.replace('.nupkg', '.snupkg');
          const symbolFile = symbolFiles.find(f => f.filename === symbolFileName);
          if (symbolFile) {
            await this.artifactProvider.downloadArtifact(symbolFile);
          }

          this.logger.info(
            `Uploading file "${file.filename}" via "dotnet nuget"` +
              (symbolFile
                ? `, including symbol file "${symbolFile.filename}"`
                : '')
          );
          await this.uploadAsset(path);
        })
      )
    );

    this.logger.info('Nuget release complete');
  }
}
