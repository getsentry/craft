import * as fs from 'fs';
import * as path from 'path';

import * as Github from '@octokit/rest';
import { shouldPerform } from 'dryrun';
// tslint:disable-next-line:no-submodule-imports
import * as simpleGit from 'simple-git/promise';

import { getGlobalGithubConfig } from '../config';
import loggerRaw from '../logger';
import { GithubGlobalConfig, TargetConfig } from '../schemas/project_config';
import { ZeusStore } from '../stores/zeus';
import { reportError } from '../utils/errors';
import { withTempDir } from '../utils/files';
import {
  getAuthUsername,
  getGithubApiToken,
  getGithubClient,
  GithubRemote,
} from '../utils/github_api';
import { renderTemplateSafe } from '../utils/strings';
import { isPreviewRelease, parseVersion } from '../utils/version';
import { BaseTarget } from './base';

const logger = loggerRaw.withScope('[registry]');

const DEFAULT_REGISTRY_REMOTE: GithubRemote = new GithubRemote(
  'getsentry',
  'sentry-release-registry'
);

/** Type of the registry package */
export enum RegistryPackageType {
  /** App is a generic package type that doesn't belong to any specific registry */
  APP = 'app',
  /** SDK is a package hosted in one of public registries (PyPI, NPM, etc.) */
  SDK = 'sdk',
}

/** "registry" target options */
export interface RegistryConfig extends TargetConfig {
  type: RegistryPackageType;
  canonicalName?: string;
  registryRemote: GithubRemote;
  linkPrereleases: boolean;
  urlTemplate?: string;
}

/**
 * Target responsible for publishing static assets to GitHub pages
 */
export class RegistryTarget extends BaseTarget {
  /** Target name */
  public readonly name: string = 'registry';
  /** Target options */
  public readonly registryConfig: RegistryConfig;
  /** Github client */
  public readonly github: Github;
  /** Github repo configuration */
  public readonly githubRepo: GithubGlobalConfig;

  public constructor(config: any, store: ZeusStore) {
    super(config, store);
    this.github = getGithubClient();
    this.githubRepo = getGlobalGithubConfig();
    this.registryConfig = this.getRegistryConfig();
  }

  /**
   * Extracts Brew target options from the raw configuration
   */
  public getRegistryConfig(): RegistryConfig {
    const registryType = this.config.type;
    if (
      [RegistryPackageType.APP, RegistryPackageType.SDK].indexOf(
        registryType
      ) === -1
    ) {
      throw new Error(`Invalid registry type specified: "${registryType}"`);
    }

    let urlTemplate;
    if (registryType === RegistryPackageType.APP) {
      urlTemplate = this.config.urlTemplate;
      if (!urlTemplate) {
        throw new Error(`Invalid "urlTemplate" specified: ${urlTemplate}`);
      }
    }

    const releaseConfig = this.config.config;
    if (!releaseConfig) {
      throw new Error(
        'Cannot find configuration dictionary for release registry'
      );
    }
    const canonicalName = releaseConfig.canonical;
    if (!canonicalName) {
      throw new Error('Canonical name not found in the configuration');
    }

    const linkPrereleases = this.config.linkPrereleases || false;
    if (typeof linkPrereleases !== 'boolean') {
      throw new Error('Invlaid type of "linkPrereleases"');
    }

    return {
      canonicalName,
      linkPrereleases,
      registryRemote: DEFAULT_REGISTRY_REMOTE,
      type: registryType,
      urlTemplate,
    };
  }

  /**
   * Creates a symlink, overwriting the existing one
   *
   * @param target Target path
   * @param newFile Path to the new symlink
   */
  public forceSymlink(target: string, newFile: string): void {
    if (fs.existsSync(newFile)) {
      fs.unlinkSync(newFile);
    }
    fs.symlinkSync(target, newFile);
  }

  /**
   * Create symbolic links to the created
   *
   * @param versionFilePath Path to the new version file
   * @param version The new version
   */
  public createSymlinks(versionFilePath: string, version: string): void {
    const parsedVersion = parseVersion(version);
    if (!parsedVersion) {
      throw new Error(`Cannot parse version: "${parsedVersion}"`);
    }
    const baseVersionName = path.basename(versionFilePath);
    const packageDir = path.dirname(versionFilePath);

    // link latest
    this.forceSymlink(baseVersionName, path.join(packageDir, 'latest.json'));

    // link major
    const majorVersionLink = `${parsedVersion.major}.json`;
    this.forceSymlink(baseVersionName, path.join(packageDir, majorVersionLink));

    // link minor
    const minorVersionLink = `${parsedVersion.major}.${
      parsedVersion.minor
    }.json`;
    this.forceSymlink(baseVersionName, path.join(packageDir, minorVersionLink));
  }

  /**
   * Returns the path to the SDK, given its canonical name
   *
   * @param registryDir The path to the local registry
   * @param canonical The SDK's canonical name
   * @returns The SDK path
   */
  public getSdkPackagePath(registryDir: string, canonical: string): string {
    const packageDirs = parseCanonical(canonical);
    return [registryDir, 'packages'].concat(packageDirs).join(path.sep);
  }

  /**
   * Returns the path to the app, given its canonical name
   *
   * @param registryDir The path to the local registry
   * @param canonical The app's canonical name
   * @returns The app path
   */
  public getAppPackagePath(registryDir: string, canonical: string): string {
    const packageDirs = parseCanonical(canonical);
    if (packageDirs[0] !== 'app') {
      throw new Error(`Invalid canonical entry for an app: ${canonical}`);
    }
    return [registryDir, 'apps'].concat(packageDirs.slice(1)).join(path.sep);
  }

  /**
   * Returns the path to the package from its canonical name
   *
   * @param registryDir The path to the local registry
   * @param canonical The app's canonical name
   */
  public getPackageDirPath(registryDir: string, canonical: string): string {
    if (this.registryConfig.type === RegistryPackageType.SDK) {
      return this.getSdkPackagePath(registryDir, canonical);
    } else if (this.registryConfig.type === RegistryPackageType.APP) {
      return this.getAppPackagePath(registryDir, canonical);
    } else {
      throw new Error(
        `Unknown registry package type: ${this.registryConfig.type}`
      );
    }
  }

  /**
   * Adds file URLs to the manifest
   *
   * URL template is taken from "urlTemplate" configuration argument
   *
   * @param manifest Package manifest
   * @param version The new version
   * @param revision Git commit SHA to be published
   */
  public async addFileLinks(
    manifest: any,
    version: string,
    revision: string
  ): Promise<void> {
    if (!this.registryConfig.urlTemplate) {
      throw new Error('No "urlTemplate" found in the config');
    }

    const artifacts = await this.getArtifactsForRevision(revision);
    if (artifacts.length === 0) {
      logger.warn('No artifacts found, not adding any links to the manifest');
      return;
    }

    const fileUrls: { [_: string]: string } = {};
    for (const artifact of artifacts) {
      fileUrls[artifact.name] = renderTemplateSafe(
        this.registryConfig.urlTemplate,
        {
          file: artifact.name,
          revision,
          version,
        }
      );
    }
    logger.debug(
      `Writing file urls to the manifest, files found: ${artifacts.length}`
    );
    manifest.file_urls = fileUrls;
  }

  /**
   * Updates the local copy of the release registry
   *
   * @param packageManifest The package's manifest object
   * @param canonical The package's canonical name
   * @param version The new version
   * @param revision Git commit SHA to be published
   */
  public async getUpdatedManifest(
    packageManifest: any,
    canonical: string,
    version: string,
    revision: string
  ): Promise<any> {
    // Additional check
    if (canonical !== packageManifest.canonical) {
      reportError(
        `Canonical name in "craft" config ("${canonical}") is inconsistent with ` +
          `the one in package manifest ("${packageManifest.canonical}")`
      );
    }
    // Update the manifest
    const updatedManifest = { ...packageManifest, version };

    // Add file links if it's a generic app
    if (this.registryConfig.type === RegistryPackageType.APP) {
      await this.addFileLinks(updatedManifest, version, revision);
    }
    return updatedManifest;
  }

  /**
   * Updates the local copy of the release registry
   *
   * @param directory The directory with the checkout out registry
   * @param canonical The package's canonical name
   * @param version The new version
   * @param revision Git commit SHA to be published
   */
  public async addVersionToRegistry(
    directory: string,
    canonical: string,
    version: string,
    revision: string
  ): Promise<void> {
    logger.info(
      `Adding the version file to the registry for canonical name "${canonical}"...`
    );
    const packageDirPath = this.getPackageDirPath(directory, canonical);

    const versionFilePath = path.join(packageDirPath, `${version}.json`);
    if (fs.existsSync(versionFilePath)) {
      throw new Error(
        `Version file for "${version}" already exists. Aborting.`
      );
    }

    const packageManifestPath = path.join(packageDirPath, 'latest.json');
    logger.debug('Reading the current configuration from "latest.json"...');
    const packageManifest =
      JSON.parse(fs.readFileSync(packageManifestPath).toString()) || {};

    const updatedManifest = await this.getUpdatedManifest(
      packageManifest,
      canonical,
      version,
      revision
    );

    logger.debug(`Writing updated manifest to "${versionFilePath}"...`);
    fs.writeFileSync(
      versionFilePath,
      JSON.stringify(updatedManifest, undefined, '  ') + '\n' // tslint:disable-line:prefer-template
    );

    this.createSymlinks(versionFilePath, version);
  }

  /**
   * Commits and pushes the new version of the package to the release registry
   *
   * @param directory The directory with the checkout out registry
   * @param remote The GitHub remote object
   * @param version The new version
   * @param revision Git commit SHA to be published
   */
  public async pushVersionToRegistry(
    directory: string,
    remote: GithubRemote,
    version: string,
    revision: string
  ): Promise<void> {
    logger.info(`Cloning "${remote.getRemoteString()}" to "${directory}"...`);
    await simpleGit()
      .silent(true)
      .clone(remote.getRemoteStringWithAuth(), directory);

    const canonical = this.registryConfig.canonicalName;
    if (!canonical) {
      throw new Error(
        '"canonical" value not found in the registry configuration'
      );
    }

    await this.addVersionToRegistry(directory, canonical, version, revision);

    const git = simpleGit(directory).silent(true);
    await git.checkout('master');

    // Commit
    await git.add(['.']);
    await git.commit(`craft: release "${canonical}", version "${version}"`);

    // Push!
    logger.info(`Pushing the changes...`);
    if (shouldPerform()) {
      await git.push('origin', 'master');
    } else {
      logger.info('[dry-run] Not pushing the branch.');
    }
  }

  /**
   * Pushes an archive with static HTML web assets to the configured branch
   */
  public async publish(version: string, revision: string): Promise<any> {
    if (this.registryConfig.linkPrereleases && isPreviewRelease(version)) {
      logger.info('Preview release detected, skipping the target');
      return undefined;
    }
    const username = await getAuthUsername(this.github);

    const remote = this.registryConfig.registryRemote;
    remote.setAuth(username, getGithubApiToken());

    // If we have includeNames specified, check that we have any of matched files
    if (this.filterOptions.includeNames) {
      const artifacts = await this.getArtifactsForRevision(revision);
      if (artifacts.length === 0) {
        logger.warn(
          `No files found that match "${
            this.filterOptions.includeNames
          }", skipping the target.`
        );
        return undefined;
      }
    }

    await withTempDir(
      async directory =>
        this.pushVersionToRegistry(directory, remote, version, revision),
      true,
      'craft-release-registry-'
    );
    logger.info('Release registry updated');
  }
}

/**
 * Parses registry canonical name to a list of registry directories
 *
 * Example: "npm:@sentry/browser" -> ["npm", "@sentry", "browser"]
 *
 * @param canonicalName Registry canonical name
 * @returns A list of directories
 */
export function parseCanonical(canonicalName: string): string[] {
  const [registry, packageName] = canonicalName.split(':');
  if (!registry || !packageName) {
    throw new Error(
      `Cannot parse canonical name for the package: ${canonicalName}`
    );
  }
  const packageDirs = packageName.split('/');
  if (packageDirs.some(x => !x)) {
    throw new Error(
      `Cannot parse canonical name for the package: ${canonicalName}`
    );
  }
  return [registry].concat(packageName.split('/'));
}
