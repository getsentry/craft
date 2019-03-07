import { SpawnOptions, spawnSync } from 'child_process';

import { Artifact } from '@zeus-ci/sdk';
import { shouldPerform } from 'dryrun';
import * as inquirer from 'inquirer';

import { logger as loggerRaw } from '../logger';
import { TargetConfig } from '../schemas/project_config';
import { ZeusStore } from '../stores/zeus';
import { ConfigurationError, reportError } from '../utils/errors';
import { checkExecutableIsPresent, spawnProcess } from '../utils/system';
import { parseVersion } from '../utils/version';
import { BaseTarget } from './base';

const logger = loggerRaw.withScope('[npm]');

/** Command to launch npm */
export const NPM_BIN = process.env.NPM_BIN || 'npm';

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
}

/** Options for running the NPM publish command */
interface NpmPublishOptions {
  /** OTP value to use */
  otp?: string;
}

/**
 * Target responsible for publishing releases on NPM
 */
export class NpmTarget extends BaseTarget {
  /** Target name */
  public readonly name: string = 'npm';
  /** Target options */
  public readonly npmConfig: NpmTargetOptions;

  public constructor(config: any, store: ZeusStore) {
    super(config, store);
    this.checkRequirements();
    this.npmConfig = this.getNpmConfig();
  }

  /**
   * Check that NPM executable exists and is not too old
   */
  protected checkRequirements(): void {
    checkExecutableIsPresent(NPM_BIN);

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

    const npmConfig: NpmTargetOptions = {};
    if (this.config.access) {
      if (this.config.access in NpmPackageAccess) {
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
    options: NpmPublishOptions = {}
  ): Promise<any> {
    const args = ['publish', NPM_REGISTRY, path];

    if (this.npmConfig.access) {
      // This parameter is only necessary for scoped packages, otherwise
      // it can be left blank
      args.push(`--access=${this.npmConfig.access}`);
    }

    // Pass OTP if configured
    const spawnOptions: SpawnOptions = {};
    if (options.otp) {
      spawnOptions.env = { ...process.env, NPM_CONFIG_OTP: options.otp };
    }

    // Disable output buffering because NPM can ask us for one-time passwords
    return spawnProcess(NPM_BIN, args, spawnOptions, { showStdout: true });
  }

  /**
   * Publishes a package tarball on the NPM registry
   *
   * @param version New version to be released
   * @param revision Git commit SHA to be published
   */
  public async publish(_version: string, revision: string): Promise<any> {
    logger.debug('Fetching artifact list from Zeus...');
    const packageFiles = await this.getArtifactsForRevision(revision, {
      includeNames: DEFAULT_PACKAGE_REGEX,
    });

    if (!packageFiles.length) {
      reportError('Cannot release to NPM: no packages found!');
      return undefined;
    }

    const publishOptions: NpmPublishOptions = {};
    if (shouldPerform() && this.npmConfig.useOtp) {
      publishOptions.otp = await this.requestOtp();
    }

    await Promise.all(
      packageFiles.map(async (file: Artifact) => {
        const path = await this.store.downloadArtifact(file);
        logger.info(`Releasing ${file.name} to NPM`);
        return this.publishPackage(path, publishOptions);
      })
    );

    logger.info('NPM release complete');
  }
}
