import { SpawnOptions, spawnSync } from 'child_process';
import prompts from 'prompts';

import { TargetConfig } from '../schemas/project_config';
import { ConfigurationError, reportError } from '../utils/errors';
import { isDryRun } from '../utils/helpers';
import { hasExecutable, spawnProcess } from '../utils/system';
import { isPreviewRelease, parseVersion } from '../utils/version';
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
    config: TargetConfig,
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
    const args = ['publish'];
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

    // In case we have a prerelease, there should never be a reason to publish
    // it with the latest tag in npm.
    if (isPreviewRelease(options.version)) {
      this.logger.warn('Detected pre-release version for npm package!');
      this.logger.warn(
        'Adding tag "next" to not make it "latest" in registry.'
      );
      args.push('--tag=next');
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
      }).catch(error => {
        // When publishing a list of packages fails for only one package,
        // you can never fix this by re-running publish because it will then _always_ fail due to existing versions.
        // Instead, in this case we want to simply ignore the already existing package and continue.
        if (error.message?.includes('You cannot publish over the previously published versions:')) {
          console.warn(error);
          return Promise.resolve();
        }

        return Promise.reject(error);
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
