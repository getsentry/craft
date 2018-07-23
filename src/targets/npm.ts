import loggerRaw from '../logger';
import { TargetConfig } from '../schemas/project_config';
import { ZeusStore } from '../stores/zeus';
import { spawnProcess } from '../utils/system';
import { BaseTarget } from './base';

const logger = loggerRaw.withScope('[npm]');

/** Command to launch npm */
export const NPM_BIN = process.env.NPM_BIN || 'npm';

/**
 * Parameter used to reset NPM to its default registry.
 * If launched from yarn, this parameter is overwritten.
 * @see https://github.com/lerna/lerna/issues/896#issuecomment-311894609
 */
export const NPM_REGISTRY = '--registry=https://registry.npmjs.org/';

/** A regular expression used to find the package tarball */
const DEFAULT_PACKAGE_REGEX = /^.*\.tgz$/;

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
    this.npmConfig = this.getNpmConfig();
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

    return spawnProcess(NPM_BIN, args);
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
    const packageFile = packageFiles[0];
    if (!packageFile) {
      logger.info('Skipping NPM release since there is no package tarball');
      return undefined;
    }

    const packagePath = await this.store.downloadArtifact(packageFile);
    logger.info(`Releasing ${packageFile.name} to NPM`);
    await this.publishPackage(packagePath);
    logger.info('NPM release completed');
  }
}
