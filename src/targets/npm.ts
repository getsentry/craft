import { SpawnOptions, spawnSync } from 'child_process';
import prompts from 'prompts';

import { TargetConfig } from '../schemas/project_config';
import { ConfigurationError, reportError } from '../utils/errors';
import { isDryRun } from '../utils/helpers';
import { hasExecutable, spawnProcess } from '../utils/system';
import {
  isPreviewRelease,
  parseVersion,
  versionGreaterOrEqualThan,
} from '../utils/version';
import { BaseTarget } from './base';
import {
  BaseArtifactProvider,
  RemoteArtifact,
} from '../artifact_providers/base';
import { withTempFile } from '../utils/files';
import { writeFileSync } from 'fs';

/** Command to launch "npm" */
export const NPM_BIN = process.env.NPM_BIN || 'npm';

/** Command to launch "yarn" */
export const YARN_BIN = process.env.YARN_BIN || 'yarn';

const NPM_MIN_MAJOR = 5;
const NPM_MIN_MINOR = 6;

const NPM_TOKEN_ENV_VAR = 'NPM_TOKEN';

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
   * Enable workspace discovery to auto-generate npm targets for all workspace packages.
   * When enabled, this target will be expanded into multiple targets, one per workspace package.
   */
  workspaces?: boolean;
  /**
   * Regex pattern to filter which workspace packages to include.
   * Only packages matching this pattern will be published.
   * Example: /^@sentry\//
   */
  includeWorkspaces?: string;
  /**
   * Regex pattern to filter which workspace packages to exclude.
   * Packages matching this pattern will not be published.
   * Example: /^@sentry-internal\//
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
  /** Value of NPM_TOKEN so we can pass it to npm executable */
  token: string;
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

  public constructor(
    config: NpmTargetConfig,
    artifactProvider: BaseArtifactProvider
  ) {
    super(config, artifactProvider);
    this.checkRequirements();
    this.npmConfig = this.getNpmConfig();
  }

  /**
   * Check that NPM executable exists and is not too old
   */
  protected checkRequirements(): void {
    if (hasExecutable(NPM_BIN)) {
      this.logger.debug('Checking that NPM has recent version...');
      const npmVersion = spawnSync(NPM_BIN, ['--version'])
        .stdout.toString()
        .trim();
      const parsedVersion = parseVersion(npmVersion);
      if (!parsedVersion) {
        reportError(`Cannot parse NPM version: "${npmVersion}"`);
      }
      const { major, minor } = parsedVersion || { major: 0, minor: 0 };
      if (
        major < NPM_MIN_MAJOR ||
        (major === NPM_MIN_MAJOR && minor < NPM_MIN_MINOR)
      ) {
        reportError(
          `NPM version is too old: ${npmVersion}. Please update your NodeJS`
        );
      }
      this.logger.debug(`Found NPM version ${npmVersion}`);
    } else if (hasExecutable(YARN_BIN)) {
      const yarnVersion = spawnSync(YARN_BIN, ['--version'])
        .stdout.toString()
        .trim();
      this.logger.debug(`Found Yarn version ${yarnVersion}`);
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
   * Extracts NPM target options from the raw configuration
   */
  protected getNpmConfig(): NpmTargetOptions {
    const token = process.env.NPM_TOKEN;
    if (!token) {
      throw new Error('NPM target: NPM_TOKEN not found in the environment');
    }

    const npmConfig: NpmTargetOptions = {
      useYarn: !!process.env.USE_YARN || !hasExecutable(NPM_BIN),
      token,
    };
    if (this.config.access) {
      if (Object.values(NpmPackageAccess).includes(this.config.access)) {
        npmConfig.access = this.config.access;
      } else {
        throw new ConfigurationError(
          `Invalid value for "npm.access" option: ${this.config.access}`
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
    options: NpmPublishOptions
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
        `//registry.npmjs.org/:_authToken=\${${NPM_TOKEN_ENV_VAR}}`
      );

      // The path has to be pushed always as the last arg
      args.push(path);

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

    const tag = await getPublishTag(
      version,
      this.config.checkPackageName,
      this.npmConfig,
      this.logger,
      publishOptions.otp
    );
    if (tag) {
      publishOptions.tag = tag;
    }

    await Promise.all(
      packageFiles.map(async (file: RemoteArtifact) => {
        const path = await this.artifactProvider.downloadArtifact(file);
        this.logger.info(`Releasing ${file.filename} to NPM`);
        return this.publishPackage(path, publishOptions);
      })
    );

    this.logger.info('NPM release complete');
  }
}

/**
 * Get the latest version for the given package.
 */
export async function getLatestVersion(
  packageName: string,
  npmConfig: NpmTargetOptions,
  otp?: NpmPublishOptions['otp']
): Promise<string | undefined> {
  const args = ['info', packageName, 'version'];
  const bin = NPM_BIN;

  try {
    const response = await withTempFile(filePath => {
      // Pass OTP if configured
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
        `//registry.npmjs.org/:_authToken=\${${NPM_TOKEN_ENV_VAR}}`
      );

      return spawnProcess(bin, args, spawnOptions);
    });

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
  otp?: NpmPublishOptions['otp']
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
    otp
  );
  const parsedLatestVersion = latestVersion && parseVersion(latestVersion);
  const parsedNewVersion = parseVersion(version);

  if (!parsedLatestVersion) {
    logger.warn(
      `Could not fetch current version for package ${checkPackageName}`
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
      `Detected older version than currently published version (${latestVersion}) for ${checkPackageName}`
    );
    logger.warn('Adding tag "old" to not make it "latest" in registry.');
    return 'old';
  }

  return undefined;
}
