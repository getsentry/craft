import { SpawnOptions, spawnSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import prompts from 'prompts';

import { TargetConfig, TypedTargetConfig } from '../schemas/project_config';
import { ConfigurationError, reportError } from '../utils/errors';
import { stringToRegexp } from '../utils/filters';
import { isDryRun } from '../utils/helpers';
import {
  hasExecutable,
  requireFirstExecutable,
  spawnProcess,
} from '../utils/system';
import {
  isPreviewRelease,
  parseVersion,
  SemVer,
  versionGreaterOrEqualThan,
} from '../utils/version';
import {
  discoverWorkspaces,
  filterWorkspacePackages,
  packageNameToArtifactPattern,
  packageNameToArtifactFromTemplate,
  topologicalSortPackages,
} from '../utils/workspaces';
import { BaseTarget } from './base';
import {
  BaseArtifactProvider,
  RemoteArtifact,
} from '../artifact_providers/base';
import { withTempFile } from '../utils/files';
import { writeFileSync } from 'fs';
import { logger } from '../logger';

/** npm executable config */
export const NPM_CONFIG = { name: 'npm', envVar: 'NPM_BIN' } as const;

/** yarn executable config */
export const YARN_CONFIG = { name: 'yarn', envVar: 'YARN_BIN' } as const;

/** Command to launch "npm" */
export const NPM_BIN = process.env.NPM_BIN || 'npm';

/** Command to launch "yarn" */
export const YARN_BIN = process.env.YARN_BIN || 'yarn';

const NPM_MIN_MAJOR = 5;
const NPM_MIN_MINOR = 6;

/** Minimum npm version required for OIDC trusted publishing support */
const NPM_OIDC_MIN_VERSION: SemVer = { major: 11, minor: 5, patch: 1 };

const NPM_TOKEN_ENV_VAR = 'NPM_TOKEN';

/**
 * Detect whether the current CI environment exposes OIDC credentials that npm
 * can use for trusted publishing.
 *
 * - GitHub Actions: sets ACTIONS_ID_TOKEN_REQUEST_URL + ACTIONS_ID_TOKEN_REQUEST_TOKEN
 *   when the workflow has `id-token: write` permission.
 * - GitLab CI/CD: sets NPM_ID_TOKEN when `id_tokens` is configured with the npm audience.
 */
function isOidcEnvironment(): boolean {
  return !!(
    (process.env.ACTIONS_ID_TOKEN_REQUEST_URL &&
      process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) ||
    process.env.NPM_ID_TOKEN
  );
}

/** A regular expression used to find the package tarball */
const DEFAULT_PACKAGE_REGEX = /^.*\d\.\d.*\.tgz$/;

/** Access specifiers for NPM packages. See npm-publish doc for more info */
export enum NpmPackageAccess {
  /** Public access: anyone can see the package */
  PUBLIC = 'public',
  /** Restricted access: scoped packages are restricted by default, for example */
  RESTRICTED = 'restricted',
}

export interface NpmTargetConfig extends TargetConfig {
  access?: NpmPackageAccess;
  /** If defined, lookup this package name on the registry to get the current latest version. */
  checkPackageName?: string;
  /**
   * Enable OIDC trusted publishing (no long-lived NPM_TOKEN required).
   * When set to `true`, forces OIDC mode and errors if the environment does not
   * support it or npm < 11.5.1.
   * When omitted, OIDC is auto-detected from CI environment variables:
   *   - GitHub Actions: ACTIONS_ID_TOKEN_REQUEST_URL + ACTIONS_ID_TOKEN_REQUEST_TOKEN
   *   - GitLab CI/CD: NPM_ID_TOKEN
   * If auto-detected and NPM_TOKEN is absent, OIDC is used automatically.
   */
  oidc?: boolean;
  /**
   * Enable workspace discovery to auto-generate npm targets for all workspace packages.
   * When enabled, this target will be expanded into multiple targets, one per workspace package.
   */
  workspaces?: boolean;
  /**
   * Regex pattern to filter which workspace packages to include.
   * Only packages matching this pattern will be published.
   * Example: '/^@sentry\\//'
   */
  includeWorkspaces?: string;
  /**
   * Regex pattern to filter which workspace packages to exclude.
   * Packages matching this pattern will not be published.
   * Example: '/^@sentry-internal\\//'
   */
  excludeWorkspaces?: string;
  /**
   * Template for generating artifact filenames from package names.
   * Variables: {{name}} (full package name), {{simpleName}} (without @scope/), {{version}}
   * Default convention: @sentry/browser -> sentry-browser-{version}.tgz
   */
  artifactTemplate?: string;
}

/** NPM target configuration options */
export interface NpmTargetOptions {
  /** Package access specifier */
  access?: NpmPackageAccess;
  /** Do we use 2FA (via OTPs) for publishing? */
  useOtp?: boolean;
  /** Do we use Yarn instead of NPM? */
  useYarn: boolean;
  /**
   * Value of NPM_TOKEN to pass to the npm executable.
   * Undefined when using OIDC without a token (publish auth is handled by npm
   * natively; getLatestVersion will run without auth and works for public packages).
   */
  token?: string;
  /** Whether to use OIDC trusted publishing instead of token-based auth */
  useOidc: boolean;
}

/** Fields on the npm target config accessed at runtime */
interface NpmTargetConfigFields extends Record<string, unknown> {
  access?: NpmPackageAccess;
  checkPackageName?: string;
  oidc?: boolean;
}

/** Options for running the NPM publish command */
interface NpmPublishOptions {
  /** OTP value to use */
  otp?: string;
  /** New version to publish */
  version: string;
  /** A tag to use for the publish. If not set, defaults to "latest" */
  tag?: string;
}

/**
 * Target responsible for publishing releases on NPM
 */
export class NpmTarget extends BaseTarget {
  /** Target name */
  public readonly name: string = 'npm';
  /** Target options */
  public readonly npmConfig: NpmTargetOptions;
  /** Parsed npm version, set during checkRequirements() */
  protected npmVersion: SemVer | null = null;

  /**
   * Expand an npm target config into multiple targets if workspaces is enabled.
   * This static method is called during config loading to expand workspace targets.
   *
   * @param config The npm target config
   * @param rootDir The root directory of the project
   * @returns Array of expanded target configs, or the original config in an array
   */
  public static async expand(
    config: NpmTargetConfig,
    rootDir: string,
  ): Promise<TargetConfig[]> {
    // If workspaces is not enabled, return the config as-is
    if (!config.workspaces) {
      return [config];
    }

    const result = await discoverWorkspaces(rootDir);

    if (result.type === 'none' || result.packages.length === 0) {
      logger.warn(
        'npm target has workspaces enabled but no workspace packages were found',
      );
      return [];
    }
    // Filter packages based on include/exclude patterns
    let includePattern: RegExp | undefined;
    let excludePattern: RegExp | undefined;

    if (config.includeWorkspaces) {
      includePattern = stringToRegexp(config.includeWorkspaces);
    }
    if (config.excludeWorkspaces) {
      excludePattern = stringToRegexp(config.excludeWorkspaces);
    }

    const filteredPackages = filterWorkspacePackages(
      result.packages,
      includePattern,
      excludePattern,
    );

    // Also filter out private packages by default (they shouldn't be published)
    const publishablePackages = filteredPackages.filter(pkg => !pkg.private);
    const privatePackageNames = new Set(
      filteredPackages.filter(pkg => pkg.private).map(pkg => pkg.name),
    );

    // Validate: public packages should not depend on private workspace packages
    for (const pkg of publishablePackages) {
      const privateDeps = pkg.workspaceDependencies.filter(dep =>
        privatePackageNames.has(dep),
      );
      if (privateDeps.length > 0) {
        throw new ConfigurationError(
          `Public package "${
            pkg.name
          }" depends on private workspace package(s): ${privateDeps.join(
            ', ',
          )}. ` +
            `Private packages cannot be published to npm, so this dependency cannot be resolved by consumers.`,
        );
      }

      // Warn about scoped packages without publishConfig.access: 'public'
      const isScoped = pkg.name.startsWith('@');
      if (isScoped && !pkg.hasPublicAccess) {
        logger.warn(
          `Scoped package "${pkg.name}" does not have publishConfig.access set to 'public'. ` +
            `This may cause npm publish to fail for public packages.`,
        );
      }
    }

    if (publishablePackages.length === 0) {
      logger.warn('No publishable workspace packages found after filtering');
      return [];
    }

    logger.info(
      `Discovered ${publishablePackages.length} publishable ${result.type} workspace packages`,
    );

    // Sort packages by dependency order (dependencies first, then dependents)
    const sortedPackages = topologicalSortPackages(publishablePackages);

    logger.debug(
      `Expanding npm workspace target to ${
        sortedPackages.length
      } packages (dependency order): ${sortedPackages
        .map(p => p.name)
        .join(', ')}`,
    );

    // Generate a target config for each package
    return sortedPackages.map(pkg => {
      // Generate the artifact pattern
      let includeNames: string;
      if (config.artifactTemplate) {
        includeNames = packageNameToArtifactFromTemplate(
          pkg.name,
          config.artifactTemplate,
        );
      } else {
        includeNames = packageNameToArtifactPattern(pkg.name);
      }

      // Create the expanded target config
      const expandedTarget: TargetConfig = {
        name: 'npm',
        id: pkg.name,
        includeNames,
      };

      // Copy over common target options
      if (config.excludeNames) {
        expandedTarget.excludeNames = config.excludeNames;
      }

      // Copy over npm-specific target options
      if (config.access) {
        expandedTarget.access = config.access;
      }
      if (config.checkPackageName) {
        expandedTarget.checkPackageName = config.checkPackageName;
      }
      if (config.oidc) {
        expandedTarget.oidc = config.oidc;
      }

      return expandedTarget;
    });
  }

  /**
   * Bump version in package.json using npm or yarn.
   * Supports workspaces - bumps root and all workspace packages.
   *
   * @param rootDir - Project root directory
   * @param newVersion - New version string to set
   * @returns true if version was bumped, false if no package.json exists
   * @throws Error if npm/yarn is not found or command fails
   */
  public static async bumpVersion(
    rootDir: string,
    newVersion: string,
  ): Promise<boolean> {
    const packageJsonPath = join(rootDir, 'package.json');
    if (!existsSync(packageJsonPath)) {
      return false;
    }

    const { bin, index: execIndex } = requireFirstExecutable(
      [NPM_CONFIG, YARN_CONFIG],
      'Install npm/yarn or define a custom preReleaseCommand in .craft.yml',
    );
    const isNpm = execIndex === 0;

    const workspaces = await discoverWorkspaces(rootDir);
    const isWorkspace =
      workspaces.type !== 'none' && workspaces.packages.length > 0;

    // --no-git-tag-version prevents npm from creating a git commit and tag
    // --allow-same-version allows setting the same version (useful for re-runs)
    const baseArgs = isNpm
      ? ['version', newVersion, '--no-git-tag-version', '--allow-same-version']
      : ['version', newVersion, '--no-git-tag-version'];

    logger.debug(`Running: ${bin} ${baseArgs.join(' ')}`);
    await spawnProcess(bin, baseArgs, { cwd: rootDir });

    if (isWorkspace) {
      if (isNpm) {
        // npm 7+ supports --workspaces flag
        const workspaceArgs = [
          ...baseArgs,
          '--workspaces',
          '--include-workspace-root',
        ];
        logger.debug(
          `Running: ${bin} ${workspaceArgs.join(' ')} (for workspaces)`,
        );
        try {
          await spawnProcess(bin, workspaceArgs, { cwd: rootDir });
        } catch {
          // If --workspaces fails (npm < 7), fall back to individual package bumping
          logger.debug(
            'npm --workspaces failed, falling back to individual package bumping',
          );
          await NpmTarget.bumpWorkspacePackagesIndividually(
            bin,
            workspaces.packages,
            newVersion,
            baseArgs,
          );
        }
      } else {
        // yarn doesn't have --workspaces for version command, bump individually
        await NpmTarget.bumpWorkspacePackagesIndividually(
          bin,
          workspaces.packages,
          newVersion,
          baseArgs,
        );
      }

      logger.info(
        `Bumped version in root and ${workspaces.packages.length} workspace packages`,
      );
    }

    return true;
  }

  /**
   * Bump version in each workspace package individually
   */
  private static async bumpWorkspacePackagesIndividually(
    bin: string,
    packages: { name: string; location: string }[],
    _newVersion: string,
    baseArgs: string[],
  ): Promise<void> {
    for (const pkg of packages) {
      const pkgJsonPath = join(pkg.location, 'package.json');
      if (!existsSync(pkgJsonPath)) {
        continue;
      }

      let pkgJson: { private?: boolean };
      try {
        pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
      } catch {
        continue;
      }

      if (pkgJson.private) {
        logger.debug(`Skipping private package: ${pkg.name}`);
        continue;
      }

      logger.debug(`Bumping version for workspace package: ${pkg.name}`);
      await spawnProcess(bin, baseArgs, { cwd: pkg.location });
    }
  }

  public constructor(
    config: NpmTargetConfig,
    artifactProvider: BaseArtifactProvider,
  ) {
    super(config, artifactProvider);
    this.checkRequirements();
    this.npmConfig = this.getNpmConfig();
  }

  /**
   * Check that NPM executable exists and is not too old.
   * Stores the parsed npm version for later OIDC version validation in getNpmConfig().
   */
  protected checkRequirements(): void {
    const config = this.config as TypedTargetConfig<NpmTargetConfigFields>;

    if (hasExecutable(NPM_BIN)) {
      this.logger.debug('Checking that NPM has recent version...');
      const npmVersionStr = spawnSync(NPM_BIN, ['--version'])
        .stdout.toString()
        .trim();
      const parsedVersion = parseVersion(npmVersionStr);
      if (!parsedVersion) {
        reportError(`Cannot parse NPM version: "${npmVersionStr}"`);
      }
      const { major = 0, minor = 0 } = parsedVersion ?? {};
      if (
        major < NPM_MIN_MAJOR ||
        (major === NPM_MIN_MAJOR && minor < NPM_MIN_MINOR)
      ) {
        reportError(
          `NPM version is too old: ${npmVersionStr}. Please update your NodeJS`,
        );
      }
      this.npmVersion = parsedVersion;
      this.logger.debug(`Found NPM version ${npmVersionStr}`);
    } else if (hasExecutable(YARN_BIN)) {
      const yarnVersion = spawnSync(YARN_BIN, ['--version'])
        .stdout.toString()
        .trim();
      this.logger.debug(`Found Yarn version ${yarnVersion}`);

      // OIDC requires npm — yarn cannot exchange OIDC tokens
      if (config.oidc) {
        throw new ConfigurationError(
          'npm target: OIDC trusted publishing requires npm, but only yarn was found. ' +
            'Install npm >= 11.5.1 to use OIDC.',
        );
      }
    } else {
      reportError('No "npm" or "yarn" found!');
    }
  }

  /**
   * Ask the user for the OTP value
   */
  protected async requestOtp(): Promise<string> {
    const { otp } = await prompts({
      message: 'Looks like your NPM account uses 2FA. Enter OTP:',
      name: 'otp',
      type: 'text',
      validate: (input: string) =>
        (input.length > 3 && input.length < 10) || 'Valid OTP, please',
    });
    return otp;
  }

  /**
   * Extracts NPM target options from the raw configuration.
   *
   * Auth strategy decision table:
   *
   * | oidc config | NPM_TOKEN set | OIDC env detected | Result              |
   * |-------------|---------------|-------------------|---------------------|
   * | true        | any           | any               | Force OIDC          |
   * | unset/false | yes           | any               | Token auth          |
   * | unset/false | no            | yes               | Auto-detect OIDC    |
   * | unset/false | no            | no                | Error (no auth)     |
   */
  protected getNpmConfig(): NpmTargetOptions {
    const config = this.config as TypedTargetConfig<NpmTargetConfigFields>;
    const token = process.env.NPM_TOKEN;
    const oidcEnv = isOidcEnvironment();

    let useOidc = false;

    if (config.oidc) {
      // Explicit OIDC mode — validate hard requirements
      if (!this.npmVersion) {
        throw new ConfigurationError(
          'npm target: OIDC trusted publishing requires npm, but only yarn was found. ' +
            'Install npm >= 11.5.1 to use OIDC.',
        );
      }
      const { major, minor, patch } = this.npmVersion;
      if (!versionGreaterOrEqualThan(this.npmVersion, NPM_OIDC_MIN_VERSION)) {
        const {
          major: minMaj,
          minor: minMin,
          patch: minPat,
        } = NPM_OIDC_MIN_VERSION;
        throw new ConfigurationError(
          `npm target: OIDC trusted publishing requires npm >= ${minMaj}.${minMin}.${minPat}, ` +
            `but found ${major}.${minor}.${patch}. Update npm (or Node.js) to use OIDC.`,
        );
      }
      useOidc = true;
    } else if (!token) {
      // No explicit token — check if we can auto-detect OIDC
      if (oidcEnv) {
        if (this.npmVersion) {
          if (
            versionGreaterOrEqualThan(this.npmVersion, NPM_OIDC_MIN_VERSION)
          ) {
            this.logger.info(
              'NPM_TOKEN not set but OIDC environment detected — using trusted publishing.',
            );
            useOidc = true;
          } else {
            // OIDC detected but npm too old — fall through to token error below
            const { major, minor, patch } = this.npmVersion;
            const {
              major: minMaj,
              minor: minMin,
              patch: minPat,
            } = NPM_OIDC_MIN_VERSION;
            this.logger.warn(
              `OIDC environment detected but npm ${major}.${minor}.${patch} is too old for trusted publishing ` +
                `(requires >= ${minMaj}.${minMin}.${minPat}). ` +
                'Falling through to token-based auth.',
            );
          }
        }
        // yarn-only + OIDC env: also falls through to token error below
      }

      if (!useOidc) {
        throw new Error('NPM target: NPM_TOKEN not found in the environment');
      }
    }

    const npmConfig: NpmTargetOptions = {
      useYarn: !useOidc && (!!process.env.USE_YARN || !hasExecutable(NPM_BIN)),
      token: token || undefined,
      useOidc,
    };

    if (config.access) {
      if (Object.values(NpmPackageAccess).includes(config.access)) {
        npmConfig.access = config.access;
      } else {
        throw new ConfigurationError(
          `Invalid value for "npm.access" option: ${config.access}`,
        );
      }
    }

    const useOtp = (process.env.CRAFT_NPM_USE_OTP || '').toLowerCase();
    if (['1', 'true', 'yes'].indexOf(useOtp) > -1) {
      npmConfig.useOtp = true;
    }
    return npmConfig;
  }

  /**
   * Publishes the tarball to the NPM registry
   *
   * @param path Absolute path to the tarball to upload
   * @returns A promise that resolves when the upload has completed
   */
  protected async publishPackage(
    path: string,
    options: NpmPublishOptions,
  ): Promise<any> {
    // NOTE: --ignore-scripts prevents execution of lifecycle scripts (prepublish,
    // prepublishOnly, prepack, postpack, publish, postpublish) which could run
    // arbitrary code during the publish process.
    const args = ['publish', '--ignore-scripts'];
    let bin: string;

    if (this.npmConfig.useYarn) {
      bin = YARN_BIN;
      args.push(`--new-version=${options.version}`);
      args.push('--non-interactive');
    } else {
      bin = NPM_BIN;
    }

    if (this.npmConfig.access) {
      // This parameter is only necessary for scoped packages, otherwise
      // it can be left blank
      args.push(`--access=${this.npmConfig.access}`);
    }

    if (options.tag) {
      args.push(`--tag=${options.tag}`);
    }

    // The path has to be pushed always as the last arg
    args.push(path);

    if (this.npmConfig.useOidc) {
      // OIDC trusted publishing: let npm handle authentication natively via
      // the OIDC environment (ACTIONS_ID_TOKEN_REQUEST_URL on GitHub Actions,
      // NPM_ID_TOKEN on GitLab CI). Do NOT inject a custom .npmrc or NPM_TOKEN —
      // that would override npm's OIDC detection.
      const spawnOptions: SpawnOptions = {};
      spawnOptions.env = { ...process.env };
      if (options.otp) {
        spawnOptions.env.NPM_CONFIG_OTP = options.otp;
      }
      // Disable output buffering because npm can ask for one-time passwords
      return spawnProcess(bin, args, spawnOptions, { showStdout: true });
    }

    return withTempFile(filePath => {
      // Pass OTP if configured
      const spawnOptions: SpawnOptions = {};
      spawnOptions.env = { ...process.env };
      if (options.otp) {
        spawnOptions.env.NPM_CONFIG_OTP = options.otp;
      }
      spawnOptions.env[NPM_TOKEN_ENV_VAR] = this.npmConfig.token;
      // NOTE(byk): Use npm_config_userconfig instead of --userconfig for yarn compat
      spawnOptions.env.npm_config_userconfig = filePath;
      writeFileSync(
        filePath,
        `//registry.npmjs.org/:_authToken=\${${NPM_TOKEN_ENV_VAR}}`,
      );

      // Disable output buffering because NPM/Yarn can ask us for one-time passwords
      return spawnProcess(bin, args, spawnOptions, {
        showStdout: true,
      });
    });
  }

  /**
   * Publishes a package tarball on the NPM registry
   *
   * @param version New version to be released
   * @param revision Git commit SHA to be published
   */
  public async publish(version: string, revision: string): Promise<any> {
    this.logger.debug('Fetching artifact list...');
    const packageFiles = await this.getArtifactsForRevision(revision, {
      includeNames: DEFAULT_PACKAGE_REGEX,
    });

    if (!packageFiles.length) {
      reportError('Cannot release to NPM: no packages found!');
      return undefined;
    }

    const publishOptions: NpmPublishOptions = { version };
    if (!isDryRun() && this.npmConfig.useOtp) {
      publishOptions.otp = await this.requestOtp();
    }

    const config = this.config as TypedTargetConfig<NpmTargetConfigFields>;
    const tag = await getPublishTag(
      version,
      config.checkPackageName,
      this.npmConfig,
      this.logger,
      publishOptions.otp,
    );
    if (tag) {
      publishOptions.tag = tag;
    }

    await Promise.all(
      packageFiles.map(async (file: RemoteArtifact) => {
        const path = await this.artifactProvider.downloadArtifact(file);
        this.logger.info(`Releasing ${file.filename} to NPM`);
        return this.publishPackage(path, publishOptions);
      }),
    );

    this.logger.info('NPM release complete');
  }
}

/**
 * Get the latest version for the given package.
 *
 * When a token is available, uses token-based auth via a temporary .npmrc.
 * When no token is available (OIDC mode without NPM_TOKEN), runs without auth —
 * this works for public packages but will fail silently for private ones.
 */
export async function getLatestVersion(
  packageName: string,
  npmConfig: NpmTargetOptions,
  otp?: NpmPublishOptions['otp'],
): Promise<string | undefined> {
  const args = ['info', packageName, 'version'];
  const bin = NPM_BIN;

  try {
    let response: Buffer | string | undefined;

    if (npmConfig.token) {
      // Token available: authenticate via temporary .npmrc
      response = await withTempFile(filePath => {
        const spawnOptions: SpawnOptions = {};
        spawnOptions.env = { ...process.env };
        if (otp) {
          spawnOptions.env.NPM_CONFIG_OTP = otp;
        }
        spawnOptions.env[NPM_TOKEN_ENV_VAR] = npmConfig.token;
        // NOTE(byk): Use npm_config_userconfig instead of --userconfig for yarn compat
        spawnOptions.env.npm_config_userconfig = filePath;
        writeFileSync(
          filePath,
          `//registry.npmjs.org/:_authToken=\${${NPM_TOKEN_ENV_VAR}}`,
        );

        return spawnProcess(bin, args, spawnOptions);
      });
    } else {
      // No token (OIDC mode without NPM_TOKEN): run without auth.
      // Works for public packages; private packages will fail and return undefined.
      const spawnOptions: SpawnOptions = {};
      spawnOptions.env = { ...process.env };
      if (otp) {
        spawnOptions.env.NPM_CONFIG_OTP = otp;
      }
      response = await spawnProcess(bin, args, spawnOptions);
    }

    if (!response) {
      return undefined;
    }

    return response.toString().trim();
  } catch {
    return undefined;
  }
}
/**
 * Get the tag to use for publishing to npm.
 * If this returns `undefined`, we'll use the default behavior from NPM
 * (which is to set the `latest` tag).
 */
export async function getPublishTag(
  version: string,
  checkPackageName: string | undefined,
  npmConfig: NpmTargetOptions,
  logger: NpmTarget['logger'],
  otp?: NpmPublishOptions['otp'],
): Promise<string | undefined> {
  if (isPreviewRelease(version)) {
    logger.warn('Detected pre-release version for npm package!');
    logger.warn('Adding tag "next" to not make it "latest" in registry.');
    return 'next';
  }

  // If no checkPackageName is given, we return undefined
  if (!checkPackageName) {
    return undefined;
  }

  const latestVersion = await getLatestVersion(
    checkPackageName,
    npmConfig,
    otp,
  );
  const parsedLatestVersion = latestVersion && parseVersion(latestVersion);
  const parsedNewVersion = parseVersion(version);

  if (!parsedLatestVersion) {
    logger.warn(
      `Could not fetch current version for package ${checkPackageName}`,
    );
    return undefined;
  }

  // If we are publishing a version that is older than the currently latest version,
  // We tag it with "old" instead of "latest"
  if (
    parsedNewVersion &&
    !versionGreaterOrEqualThan(parsedNewVersion, parsedLatestVersion)
  ) {
    logger.warn(
      `Detected older version than currently published version (${latestVersion}) for ${checkPackageName}`,
    );
    logger.warn('Adding tag "old" to not make it "latest" in registry.');
    return 'old';
  }

  return undefined;
}
