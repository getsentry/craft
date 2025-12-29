import { TargetConfig } from '../schemas/project_config';
import { forEachChained } from '../utils/async';
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
  /** Target name */
  public readonly name: string = 'nuget';
  /** Target options */
  public readonly nugetConfig: NugetTargetOptions;

  /**
   * Expand a nuget target config into multiple targets if workspaces is enabled.
   * This static method is called during config loading to expand workspace targets.
   *
   * @param config The nuget target config
   * @param rootDir The root directory of the project
   * @returns Array of expanded target configs, or the original config in an array
   */
  public static async expand(
    config: NugetTargetConfig,
    rootDir: string
  ): Promise<TargetConfig[]> {
    // If workspaces is not enabled, return the config as-is
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

    // Convert to workspace packages for filtering
    const workspacePackages = result.packages.map(pkg => ({
      name: pkg.packageId,
      location: pkg.projectPath,
      private: !pkg.isPackable,
      hasPublicAccess: true,
      workspaceDependencies: pkg.projectDependencies,
    }));

    // Filter packages based on include/exclude patterns
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

    // Map back to DotnetPackage for sorting
    const filteredNames = new Set(filteredWorkspacePackages.map(p => p.name));
    const filteredPackages = result.packages.filter(p =>
      filteredNames.has(p.packageId)
    );

    // Sort packages topologically (dependencies first)
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

    // Generate a target config for each package
    return sortedPackages.map(pkg => {
      // Generate the artifact pattern
      let includeNames: string;
      if (config.artifactTemplate) {
        includeNames = packageIdToNugetArtifactFromTemplate(
          pkg.packageId,
          config.artifactTemplate
        );
      } else {
        includeNames = packageIdToNugetArtifactPattern(pkg.packageId);
      }

      // Create the expanded target config
      const expandedTarget: TargetConfig = {
        name: 'nuget',
        id: pkg.packageId,
        includeNames,
      };

      // Copy over common target options
      if (config.excludeNames) {
        expandedTarget.excludeNames = config.excludeNames;
      }

      // Copy over nuget-specific target options
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
   *
   * @param path Absolute path to the archive to upload
   * @returns A promise that resolves when the upload has completed
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
   *
   * @param version New version to be released
   * @param revision Git commit SHA to be published
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

    // Emit the .NET version for informational purposes.
    this.logger.info('.NET Version:');
    await spawnProcess(NUGET_DOTNET_BIN, ['--version'], DOTNET_SPAWN_OPTIONS);

    // Also emit the nuget version, which is informative and works around a bug.
    // See https://github.com/NuGet/Home/issues/12159#issuecomment-1278360511
    this.logger.info('Nuget Version:');
    await spawnProcess(
      NUGET_DOTNET_BIN,
      ['nuget', '--version'],
      DOTNET_SPAWN_OPTIONS
    );

    // Publish packages sequentially to avoid reentrancy issues with NuGet.org
    // When using workspace expansion, packages are already sorted in dependency order
    await forEachChained(packageFiles, async (file: RemoteArtifact) => {
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
    });

    this.logger.info('Nuget release complete');
  }
}
