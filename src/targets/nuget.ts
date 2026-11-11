import {
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'fs';
import { isAbsolute, join, relative, sep } from 'path';
import { randomUUID } from 'crypto';

import { TargetConfig, TypedTargetConfig } from '../schemas/project_config';
import { ConfigurationError, reportError } from '../utils/errors';
import { stringToRegexp } from '../utils/filters';
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
import {
  discoverDotnetPackages,
  sortDotnetPackages,
  packageIdToNugetArtifactPattern,
} from '../utils/dotnetWorkspaces';
import { filterWorkspacePackages } from '../utils/workspaces';
import { getGitHubOidcRequest, getGitHubOidcToken } from '../utils/githubOidc';
import {
  getRemotePackageState,
  isSymbolPackagePublished,
} from '../utils/nugetRegistry';
import { logger } from '../logger';
import { setMsBuildVersion } from '../utils/versionPatterns';

/** Command to launch dotnet tools */
export const NUGET_DOTNET_BIN = process.env.NUGET_DOTNET_BIN || 'dotnet';

/** Default Nuget registry URL */
export const DEFAULT_NUGET_SERVER_URL = 'https://api.nuget.org/v3/index.json';

/**
 * nuget.org user for trusted publishing. When set, Craft exchanges a GitHub
 * Actions OIDC token for a temporary API key instead of using NUGET_API_TOKEN.
 */
const NUGET_USER_ENV_VAR = 'NUGET_USER';

/** nuget.org endpoint that exchanges an OIDC token for a temporary API key */
export const NUGET_TOKEN_SERVICE_URL = 'https://www.nuget.org/api/v2/token';

/** OIDC audience that nuget.org accepts */
const NUGET_OIDC_AUDIENCE = 'https://www.nuget.org';

/**
 * nuget.org's temporary API keys are valid for 1 hour. Get a new one well
 * before that, so a key never expires in the middle of a push.
 */
const TEMPORARY_API_KEY_MAX_AGE_MS = 45 * 60 * 1000;

const REQUEST_TIMEOUT_MS = 30_000;

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
   * Path to the solution file (.slnx or .sln) relative to the repository root.
   * If not specified, auto-discovers a solution file in the root directory, preferring .slnx.
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
  /** NuGet server URL */
  serverUrl?: string;
}

/** Nuget target configuration options */
export interface NugetTargetOptions {
  /** Long-lived Nuget API token, used when trusted publishing is off */
  apiToken?: string;
  /** nuget.org user to get temporary API keys for, with trusted publishing */
  trustedPublishingUser?: string;
  /** Nuget server URL */
  serverUrl: string;
}

/** Config fields for nuget target from .craft.yml */
interface NugetYamlConfig extends Record<string, unknown> {
  serverUrl?: string;
}

/** Returns the trimmed text of the first `<tag>...</tag>` in an XML file */
function readXmlTag(content: string, tag: string): string | undefined {
  return new RegExp(`<${tag}>([^<]+)</${tag}>`).exec(content)?.[1].trim();
}

/**
 * Target responsible for publishing releases on Nuget
 */
export class NugetTarget extends BaseTarget {
  public readonly name: string = 'nuget';
  public readonly nugetConfig: NugetTargetOptions;
  /** Temporary API key from trusted publishing, shared by parallel pushes */
  private temporaryApiKey?: { value: Promise<string>; expiresAt: number };

  /**
   * Expand a nuget target config into multiple targets if workspaces is enabled.
   *
   * The solution is always resolved from `rootDir` (the repository root), so
   * `solutionPath` keeps its meaning. When a release workspace is selected,
   * `releaseUnitDir` is its directory and only projects inside it are kept.
   */
  public static async expand(
    config: NugetTargetConfig,
    rootDir: string,
    releaseUnitDir = rootDir,
  ): Promise<TargetConfig[]> {
    if (!config.workspaces) {
      return [config];
    }

    const result = await discoverDotnetPackages(rootDir, config.solutionPath);

    if (!result || result.packages.length === 0) {
      throw new ConfigurationError(
        'nuget target has workspaces enabled but no packable projects were found' +
          (result ? ` in ${result.solutionPath}` : '') +
          '. Check that the solution file exists and lists your projects, or set "solutionPath".',
      );
    }

    const releaseUnitPath = relative(rootDir, releaseUnitDir);
    const discoveredPackages = releaseUnitPath
      ? result.packages.filter(pkg => {
          const projectPath = relative(releaseUnitDir, pkg.projectPath);
          return (
            projectPath !== '..' &&
            !projectPath.startsWith(`..${sep}`) &&
            !isAbsolute(projectPath)
          );
        })
      : result.packages;

    if (discoveredPackages.length === 0) {
      throw new ConfigurationError(
        `nuget target has workspaces enabled but none of the packable projects in ${result.solutionPath} ` +
          `are inside the selected workspace "${releaseUnitPath}".`,
      );
    }

    const workspacePackages = discoveredPackages.map(pkg => ({
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
      excludePattern,
    );

    if (filteredWorkspacePackages.length === 0) {
      throw new ConfigurationError(
        'nuget target has workspaces enabled but no packages are left after applying "includeWorkspaces"/"excludeWorkspaces"',
      );
    }

    const filteredNames = new Set(filteredWorkspacePackages.map(p => p.name));
    const filteredPackages = discoveredPackages.filter(p =>
      filteredNames.has(p.packageId),
    );

    const sortedPackages = sortDotnetPackages(filteredPackages);

    logger.info(
      `Discovered ${sortedPackages.length} publishable NuGet packages from ${result.solutionPath}`,
    );
    logger.debug(
      `Expanding nuget workspace target to ${
        sortedPackages.length
      } packages (dependency order): ${sortedPackages
        .map(p => p.packageId)
        .join(', ')}`,
    );

    return sortedPackages.map(pkg => {
      const expandedTarget: TargetConfig = {
        name: 'nuget',
        id: pkg.packageId,
        includeNames: packageIdToNugetArtifactPattern(pkg.packageId),
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

  /**
   * Read the package version from Directory.Build.props, or from the first
   * .csproj that declares one, in the same order bumpVersion() edits them.
   *
   * @param rootDir - Project root directory
   * @returns The `<PackageVersion>`, `<Version>`, or `<VersionPrefix>` with
   * its `<VersionSuffix>`, or undefined if no .NET project file declares one
   */
  public static async readVersion(
    rootDir: string,
  ): Promise<string | undefined> {
    const projectFiles = [
      'Directory.Build.props',
      ...readdirSync(rootDir).filter(f => f.endsWith('.csproj')),
    ]
      .map(file => join(rootDir, file))
      .filter(file => existsSync(file));

    for (const file of projectFiles) {
      const content = readFileSync(file, 'utf-8');
      const version =
        readXmlTag(content, 'PackageVersion') ?? readXmlTag(content, 'Version');
      if (version) {
        return version;
      }
      // Without <Version>, MSBuild builds it as <VersionPrefix>-<VersionSuffix>
      const prefix = readXmlTag(content, 'VersionPrefix');
      if (prefix) {
        const suffix = readXmlTag(content, 'VersionSuffix');
        return suffix ? `${prefix}-${suffix}` : prefix;
      }
    }
    return undefined;
  }

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
      // `dotnet-setversion` operates in cwd and will pickup global.json,
      // which breaks if the pinned SDK isn't installed on the craft runner.
      // See: https://github.com/getsentry/craft/issues/819
      const globalJsonPath = join(rootDir, 'global.json');
      const globalJsonBackup = `${globalJsonPath}.craft-bak-${randomUUID()}`;
      const globalJsonMoved = existsSync(globalJsonPath);
      if (globalJsonMoved) {
        renameSync(globalJsonPath, globalJsonBackup);
      }
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
      } finally {
        if (globalJsonMoved) {
          renameSync(globalJsonBackup, globalJsonPath);
        }
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
    const newContent = setMsBuildVersion(content, newVersion);
    if (newContent === undefined) {
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
    const config = this.config as TypedTargetConfig<NugetYamlConfig>;
    const serverUrl = config.serverUrl || DEFAULT_NUGET_SERVER_URL;

    const trustedPublishingUser = process.env[NUGET_USER_ENV_VAR];
    if (trustedPublishingUser) {
      if (!getGitHubOidcRequest()) {
        throw new ConfigurationError(
          `Cannot perform Nuget release: ${NUGET_USER_ENV_VAR} is set, so Craft uses trusted publishing, ` +
            'but GitHub Actions OIDC is not available. Run in GitHub Actions with the ' +
            `"id-token: write" permission, or unset ${NUGET_USER_ENV_VAR} to use NUGET_API_TOKEN.`,
        );
      }
      // The temporary key is for nuget.org only; never send it to another feed.
      if (serverUrl !== DEFAULT_NUGET_SERVER_URL) {
        throw new ConfigurationError(
          `Cannot perform Nuget release: trusted publishing (${NUGET_USER_ENV_VAR}) only works with ` +
            `${DEFAULT_NUGET_SERVER_URL}, but serverUrl is ${serverUrl}.`,
        );
      }
      return { trustedPublishingUser, serverUrl };
    }

    if (!process.env.NUGET_API_TOKEN) {
      throw new ConfigurationError(
        `Cannot perform Nuget release: missing credentials.
         Please set ${NUGET_USER_ENV_VAR} (trusted publishing) or NUGET_API_TOKEN.`,
      );
    }
    return { apiToken: process.env.NUGET_API_TOKEN, serverUrl };
  }

  /**
   * Returns the API key to push with: NUGET_API_TOKEN, or with trusted
   * publishing, a temporary key that is renewed before it expires.
   */
  private getApiKey(): Promise<string> {
    const { apiToken, trustedPublishingUser } = this.nugetConfig;
    if (!trustedPublishingUser) {
      return Promise.resolve(apiToken ?? '');
    }
    if (!this.temporaryApiKey || Date.now() >= this.temporaryApiKey.expiresAt) {
      this.temporaryApiKey = {
        value: this.requestTemporaryApiKey(trustedPublishingUser),
        expiresAt: Date.now() + TEMPORARY_API_KEY_MAX_AGE_MS,
      };
    }
    return this.temporaryApiKey.value;
  }

  /**
   * Exchanges a GitHub Actions OIDC token for a temporary nuget.org API key,
   * as described in https://learn.microsoft.com/nuget/nuget-org/trusted-publishing
   */
  private async requestTemporaryApiKey(user: string): Promise<string> {
    const oidcRequest = getGitHubOidcRequest();
    if (!oidcRequest) {
      throw new Error('GitHub Actions OIDC is no longer available');
    }
    const oidcToken = await getGitHubOidcToken(
      oidcRequest,
      NUGET_OIDC_AUDIENCE,
    );

    this.logger.info(
      `Requesting a temporary NuGet API key for "${user}" with trusted publishing`,
    );
    const response = await fetch(NUGET_TOKEN_SERVICE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${oidcToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'getsentry/craft',
      },
      body: JSON.stringify({ username: user, tokenType: 'ApiKey' }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      const details = (await response.text().catch(() => '')).slice(0, 500);
      throw new Error(
        `NuGet trusted publishing token exchange failed: HTTP ${response.status}` +
          (details ? `: ${details}` : '') +
          '\n\nCheck that a trusted publishing policy on nuget.org matches this repository, ' +
          `workflow file and environment, and that ${NUGET_USER_ENV_VAR} is the nuget.org user ` +
          'who created the policy, not the organization that owns it.',
      );
    }
    const { apiKey } = (await response.json()) as { apiKey?: string };
    if (!apiKey) {
      throw new Error(
        'NuGet trusted publishing token exchange returned no API key',
      );
    }
    if (process.env.GITHUB_ACTIONS === 'true') {
      // Keep the key out of the workflow logs, like NuGet/login does.
      process.stdout.write(`::add-mask::${apiKey}\n`);
    }
    return apiKey;
  }

  /**
   * Uploads an archive to Nuget using "dotnet nuget"
   *
   * The key is passed as a `${...}` placeholder that spawnProcess fills in,
   * so it never shows up in the logged command line.
   */
  public async uploadAsset(path: string, apiKey: string): Promise<any> {
    const args = [
      'nuget',
      'push',
      path,
      '--api-key',
      '${NUGET_API_KEY}',
      '--source',
      this.nugetConfig.serverUrl,
      '--timeout',
      '1800',
    ];
    return spawnProcess(NUGET_DOTNET_BIN, args, {
      ...DOTNET_SPAWN_OPTIONS,
      env: { ...process.env, NUGET_API_KEY: apiKey },
    });
  }

  /**
   * Pushes a file, adding a hint when NuGet rejects it as a duplicate.
   */
  private async push(path: string): Promise<void> {
    const apiKey = await this.getApiKey();
    try {
      await this.uploadAsset(path, apiKey);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/\b409\b|already (contains|exists)/i.test(message)) {
        throw new Error(
          `${message}\n\nNuGet rejected the push because this version already exists. ` +
            'If it was uploaded in the last few minutes, NuGet may still be validating it ' +
            'and not serving it yet. Wait a few minutes and retry, so Craft can compare the ' +
            'published package with the local one. Otherwise, publish a new version.',
          { cause: error },
        );
      }
      throw error;
    }
  }

  /**
   * Publishes one .nupkg and, if there is one, its .snupkg.
   *
   * Before pushing, checks whether the version is already on the server, so
   * that a retried release can recover from a partially completed publish
   * without `--skip-duplicate`:
   *
   * - not published: push the .nupkg, which also pushes the .snupkg next to it
   * - published with identical contents (ignoring the repository signature
   *   the server adds): skip the .nupkg, and push the .snupkg on its own if
   *   the server doesn't have it yet
   * - published with different contents: fail, since NuGet versions are
   *   immutable and the release must not look successful
   *
   * If the server state can't be determined, the .nupkg is pushed as usual,
   * so an existing version still makes the push fail loudly.
   */
  private async publishPackage(
    file: RemoteArtifact,
    symbolFile?: RemoteArtifact,
  ): Promise<void> {
    // The .snupkg is downloaded next to the .nupkg (both go to the artifact
    // provider's download directory), so pushing the .nupkg picks it up
    // automatically. That way the .snupkg is only sent once the .nupkg push
    // succeeded.
    const path = await this.artifactProvider.downloadArtifact(file);
    const symbolPath = symbolFile
      ? await this.artifactProvider.downloadArtifact(symbolFile)
      : undefined;
    const serverUrl = this.nugetConfig.serverUrl;

    const state = await getRemotePackageState(serverUrl, path);

    if (state.status === 'different') {
      const shown = state.differences.slice(0, 10).join(', ');
      const more =
        state.differences.length > 10
          ? ` and ${state.differences.length - 10} more`
          : '';
      throw new Error(
        `"${file.filename}" is already published on ${serverUrl} with different contents ` +
          `(differs in: ${shown}${more}). NuGet versions are immutable, so publish a new version instead.`,
      );
    }

    if (state.status === 'identical') {
      this.logger.info(
        `"${file.filename}" is already published with identical contents, not pushing it again.`,
      );
      if (!symbolFile || !symbolPath) {
        return;
      }
      const symbolsPublished = await isSymbolPackagePublished(
        serverUrl,
        state.identity,
      );
      if (symbolsPublished) {
        this.logger.info(
          `Symbol package "${symbolFile.filename}" is already published, nothing to do.`,
        );
        return;
      }
      this.logger.info(
        symbolsPublished === false
          ? `Symbol package "${symbolFile.filename}" is not published yet, uploading it via "dotnet nuget"`
          : `Could not check whether symbol package "${symbolFile.filename}" is published, uploading it via "dotnet nuget"`,
      );
      await this.push(symbolPath);
      return;
    }

    if (state.status === 'unknown') {
      this.logger.info(
        `Could not check whether "${file.filename}" is already published (${state.reason}), pushing it.`,
      );
    }
    this.logger.info(
      `Uploading file "${file.filename}" via "dotnet nuget"` +
        (symbolFile ? `, including symbol file "${symbolFile.filename}"` : ''),
    );
    await this.push(path);
  }

  /**
   * Publishes a package tarball to the Nuget registry
   */
  public async publish(_version: string, revision: string): Promise<any> {
    this.logger.debug('Fetching artifact list...');
    // A target-level `includeNames` (e.g. from workspace expansion) overrides
    // the default regexes and may match both .nupkg and .snupkg files, so
    // split by extension. Symbol packages are pushed alongside their .nupkg
    // and must never be pushed on their own.
    const packageFiles = (
      await this.getArtifactsForRevision(revision, {
        includeNames: DEFAULT_NUGET_REGEX,
      })
    ).filter(file => file.filename.endsWith('.nupkg'));
    const symbolFiles = (
      await this.getArtifactsForRevision(revision, {
        includeNames: SYMBOLS_NUGET_REGEX,
      })
    ).filter(file => file.filename.endsWith('.snupkg'));

    if (!packageFiles.length) {
      reportError(
        'Cannot release to Nuget: there are no Nuget packages found!',
      );
    }

    this.logger.info('.NET Version:');
    await spawnProcess(NUGET_DOTNET_BIN, ['--version'], DOTNET_SPAWN_OPTIONS);

    // Works around a bug: https://github.com/NuGet/Home/issues/12159#issuecomment-1278360511
    this.logger.info('Nuget Version:');
    await spawnProcess(
      NUGET_DOTNET_BIN,
      ['nuget', '--version'],
      DOTNET_SPAWN_OPTIONS,
    );

    await Promise.all(
      packageFiles.map(async (file: RemoteArtifact) => {
        const symbolFileName = file.filename.replace('.nupkg', '.snupkg');
        const symbolFile = symbolFiles.find(f => f.filename === symbolFileName);
        return this.publishPackage(file, symbolFile);
      }),
    );

    this.logger.info('Nuget release complete');
  }
}
