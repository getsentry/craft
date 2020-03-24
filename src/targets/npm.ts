import { SpawnOptions, spawnSync } from 'child_process';
import * as inquirer from 'inquirer';

import { logger as loggerRaw } from '../logger';
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

const logger = loggerRaw.withScope('[npm]');

/** Command to launch "npm" */
export const NPM_BIN = process.env.NPM_BIN || 'npm';

/** Command to launch "yarn" */
export const YARN_BIN = process.env.YARN_BIN || 'yarn';

const NPM_MIN_MAJOR = 5;
const NPM_MIN_MINOR = 6;

/**
 * Parameter used to reset NPM to its default registry.
 * If launched from yarn, this parameter is overwritten.
 * @see https://github.com/lerna/lerna/issues/896#issuecomment-311894609
 */
export const NPM_REGISTRY = '--registry=https://registry.npmjs.org/';

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
export interface NpmTargetOptions extends TargetConfig {
  /** Package access specifier */
  access?: NpmPackageAccess;
  /** Do we use 2FA (via OTPs) for publishing? */
  useOtp?: boolean;
  /** Do we use Yarn instead of NPM? */
  useYarn: boolean;
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

  public constructor(config: any, artifactProvider: BaseArtifactProvider) {
    super(config, artifactProvider);
    this.checkRequirements();
    this.npmConfig = this.getNpmConfig();
  }

  /**
   * Check that NPM executable exists and is not too old
   */
  protected checkRequirements(): void {
    if (hasExecutable(NPM_BIN)) {
      logger.debug('Checking that NPM has recent version...');
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
      logger.debug(`Found NPM version ${npmVersion}`);
    } else if (hasExecutable(YARN_BIN)) {
      const yarnVersion = spawnSync(YARN_BIN, ['--version'])
        .stdout.toString()
        .trim();
      logger.debug(`Found Yarn version ${yarnVersion}`);
    } else {
      reportError('No "npm" or "yarn" found!');
    }
  }

  /**
   * Ask the user for the OTP value
   */
  protected async requestOtp(): Promise<string> {
    const questions = [
      {
        message: 'Looks like your NPM account uses 2FA. Enter OTP:',
        name: 'otp',
        type: 'input',
        validate: (input: string) =>
          (input.length > 3 && input.length < 10) || 'Valid OTP, please',
      },
    ];
    const answers = (await inquirer.prompt(questions)) as any;
    return answers.otp;
  }

  /**
   * Extracts NPM target options from the raw configuration
   */
  protected getNpmConfig(): NpmTargetOptions {
    // TODO figure out how to pass the token to NPM.
    // There are no env vars we can pass, only .npmrc approach seems to work

    // const npmToken = process.env.NPM_TOKEN;
    // if (!npmToken) {
    //   throw new Error('NPM target: NPM_TOKEN not found in the environment');
    // }

    const npmConfig: NpmTargetOptions = {
      useYarn: !hasExecutable(NPM_BIN),
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
    const args = ['publish', NPM_REGISTRY, path];
    let bin: string;

    if (this.npmConfig.useYarn) {
      bin = YARN_BIN;
      args.push(`--new-version=${options.version}`);
      args.push('--non-interactive');
    } else {
      bin = NPM_BIN;
      if (this.npmConfig.access) {
        // This parameter is only necessary for scoped packages, otherwise
        // it can be left blank
        args.push(`--access=${this.npmConfig.access}`);
      }
    }

    // In case we have a prerelease, there should never be a reason to publish
    // it with the latest tag in npm.
    if (isPreviewRelease(options.version)) {
      logger.warn('Detected pre-release version for npm package!');
      logger.warn('Adding tag "next" to not make it "latest" in registry.');
      args.push('--tag=next');
    }

    // Pass OTP if configured
    const spawnOptions: SpawnOptions = {};
    if (options.otp) {
      spawnOptions.env = { ...process.env, NPM_CONFIG_OTP: options.otp };
    }

    // Disable output buffering because NPM/Yarn can ask us for one-time passwords
    return spawnProcess(bin, args, spawnOptions, { showStdout: true });
  }

  /**
   * Publishes a package tarball on the NPM registry
   *
   * @param version New version to be released
   * @param revision Git commit SHA to be published
   */
  public async publish(version: string, revision: string): Promise<any> {
    logger.debug('Fetching artifact list...');
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
        logger.info(`Releasing ${file.filename} to NPM`);
        return this.publishPackage(path, publishOptions);
      })
    );

    logger.info('NPM release complete');
  }
}
