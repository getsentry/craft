import { spawnSync } from 'child_process';

import { Artifact } from '@zeus-ci/sdk';

import loggerRaw from '../logger';
import { TargetConfig } from '../schemas/project_config';
import { ZeusStore } from '../stores/zeus';
import { reportError } from '../utils/errors';
import { checkExecutableIsPresent, spawnProcess } from '../utils/system';
import { parseVersion } from '../utils/version';
import { BaseTarget } from './base';

const logger = loggerRaw.withScope('[npm]');

/** Command to launch npm */
export const NPM_BIN = process.env.NPM_BIN || 'npm';

const NPM_MIN_MAJOR = 5;
const NPM_MIN_MINOR = 5;

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
  access?: NpmPackageAccess;
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
        throw new Error(
          `Invalid value for "npm.access" option: ${this.config.access}`
        );
      }
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
    access: NpmPackageAccess = NpmPackageAccess.PUBLIC
  ): Promise<any> {
    const args = ['publish', NPM_REGISTRY, path];

    const packageAccess = this.npmConfig.access || access;
    if (packageAccess) {
      // This parameter is only necessary for scoped packages, otherwise
      // it can be left blank
      args.push(`--access=${packageAccess}`);
    }

    // Disable output buffering because NPM can ask us for one-time passwords
    return spawnProcess(NPM_BIN, args, {}, { showStdout: true });
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

    await Promise.all(
      packageFiles.map(async (file: Artifact) => {
        const path = await this.store.downloadArtifact(file);
        logger.info(`Releasing ${file.name} to NPM`);
        return this.publishPackage(path);
      })
    );

    logger.info('NPM release complete');
  }
}
