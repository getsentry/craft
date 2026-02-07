import { existsSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';

import { TargetConfig, TypedTargetConfig } from '../schemas/project_config';
import { ConfigurationError, reportError } from '../utils/errors';
import {
  checkExecutableIsPresent,
  hasExecutable,
  spawnProcess,
} from '../utils/system';
import { BaseTarget } from './base';
import {
  BaseArtifactProvider,
  RemoteArtifact,
} from '../artifact_providers/base';
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

/** Nuget target configuration options */
export interface NugetTargetOptions {
  /** Nuget API token */
  apiToken: string;
  /** Nuget server URL */
  serverUrl: string;
}

/** Config fields for nuget target from .craft.yml */
interface NugetYamlConfig extends Record<string, unknown> {
  serverUrl?: string;
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
   * Bump version in .NET project files (.csproj, Directory.Build.props).
   *
   * Tries dotnet-setversion first if available, otherwise edits XML directly.
   *
   * @param rootDir - Project root directory
   * @param newVersion - New version string to set
   * @returns true if version was bumped, false if no .NET project found
   * @throws Error if version cannot be updated
   */
  public static async bumpVersion(
    rootDir: string,
    newVersion: string,
  ): Promise<boolean> {
    // Check for .NET project files
    const csprojFiles = readdirSync(rootDir).filter(f => f.endsWith('.csproj'));
    const hasDotNet =
      csprojFiles.length > 0 ||
      existsSync(join(rootDir, 'Directory.Build.props'));

    if (!hasDotNet) {
      return false;
    }

    if (hasExecutable(NUGET_DOTNET_BIN)) {
      try {
        const result = await spawnProcess(
          NUGET_DOTNET_BIN,
          ['setversion', newVersion],
          { cwd: rootDir },
          { enableInDryRunMode: true },
        );
        if (result !== null) {
          return true;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (
          !message.includes('not installed') &&
          !message.includes('Could not execute')
        ) {
          throw error;
        }
        logger.debug(
          'dotnet-setversion not available, falling back to manual edit',
        );
      }
    }

    let bumped = false;

    // Try Directory.Build.props first (centralized version management)
    const buildPropsPath = join(rootDir, 'Directory.Build.props');
    if (existsSync(buildPropsPath)) {
      if (NugetTarget.updateVersionInXml(buildPropsPath, newVersion)) {
        bumped = true;
      }
    }

    if (!bumped) {
      for (const csproj of csprojFiles) {
        const csprojPath = join(rootDir, csproj);
        if (NugetTarget.updateVersionInXml(csprojPath, newVersion)) {
          bumped = true;
        }
      }
    }

    return bumped;
  }

  /**
   * Update version in an XML project file (.csproj or Directory.Build.props)
   */
  private static updateVersionInXml(
    filePath: string,
    newVersion: string,
  ): boolean {
    const content = readFileSync(filePath, 'utf-8');

    // Match <Version>x.y.z</Version> or <PackageVersion>x.y.z</PackageVersion>
    const versionPatterns = [
      /(<Version>)([^<]+)(<\/Version>)/g,
      /(<PackageVersion>)([^<]+)(<\/PackageVersion>)/g,
      /(<AssemblyVersion>)([^<]+)(<\/AssemblyVersion>)/g,
      /(<FileVersion>)([^<]+)(<\/FileVersion>)/g,
    ];

    let newContent = content;
    let updated = false;

    for (const pattern of versionPatterns) {
      if (pattern.test(newContent)) {
        // Reset lastIndex for global regex
        pattern.lastIndex = 0;
        newContent = newContent.replace(pattern, `$1${newVersion}$3`);
        updated = true;
      }
    }

    if (!updated) {
      return false;
    }

    if (newContent === content) {
      return true; // Already at target version
    }

    logger.debug(`Updating version in ${filePath} to ${newVersion}`);
    writeFileSync(filePath, newContent);

    return true;
  }

  public constructor(
    config: TargetConfig,
    artifactProvider: BaseArtifactProvider,
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
         Please use NUGET_API_TOKEN environment variable.`,
      );
    }
    const config = this.config as TypedTargetConfig<NugetYamlConfig>;
    return {
      apiToken: process.env.NUGET_API_TOKEN,
      serverUrl: config.serverUrl || DEFAULT_NUGET_SERVER_URL,
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
      // Warning: `--skip-duplicate` means we will NOT error when a version
      //          already exists. This is unlike any other target in Craft but
      //          became needed here as NuGet repo is quite flaky and we need to
      //          publish many packages at once without another way to resume a
      //          broken release.
      '--skip-duplicate',
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
        'Cannot release to Nuget: there are no Nuget packages found!',
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
      DOTNET_SPAWN_OPTIONS,
    );

    await Promise.all(
      packageFiles.map(async (file: RemoteArtifact) => {
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
              : ''),
        );
        return this.uploadAsset(path);
      }),
    );

    this.logger.info('Nuget release complete');
  }
}
