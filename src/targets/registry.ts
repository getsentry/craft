import * as fs from 'fs';
import * as path from 'path';

import * as Github from '@octokit/rest';
// tslint:disable-next-line:no-submodule-imports
import * as simpleGit from 'simple-git/promise';

import { getGlobalGithubConfig } from '../config';
import loggerRaw from '../logger';
import { GithubGlobalConfig, TargetConfig } from '../schemas/project_config';
import { ZeusStore } from '../stores/zeus';
import { withTempDir } from '../utils/files';
import {
  getGithubApiToken,
  getGithubClient,
  GithubRemote,
  getAuthUsername,
} from '../utils/github_api';
import { BaseTarget } from './base';
import { parseVersion, isPreviewRelease } from '../utils/version';
import { shouldPerform } from 'dryrun';

const logger = loggerRaw.withScope('[registry]');

const DEFAULT_REGISTRY_REMOTE: GithubRemote = new GithubRemote(
  'getsentry',
  'sentry-release-registry'
);

export enum RegistryPackageType {
  APP = 'app',
  SDK = 'sdk',
}

/** "registry" target options */
export interface RegistryConfig extends TargetConfig {
  type: RegistryPackageType;
  canonicalName?: string;
  registryRemote: GithubRemote;
  linkPrereleases: boolean;
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
    };
  }

  public forceSymlink(target: string, newFile: string): void {
    if (fs.existsSync(newFile)) {
      fs.unlinkSync(newFile);
    }
    fs.symlinkSync(target, newFile);
  }

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

  public getSdkPackagePath(repoDir: string, canonical: string): string {
    const packageDirs = parseCanonical(canonical);
    return [repoDir, 'packages'].concat(packageDirs).join(path.sep);
  }

  public getAppPackagePath(repoDir: string, canonical: string): string {
    const packageDirs = parseCanonical(canonical);
    if (packageDirs[0] !== 'app') {
      throw new Error(`Invalid canonical entry for an app: ${canonical}`);
    }
    return [repoDir, 'apps'].concat(packageDirs.slice(1)).join(path.sep);
  }

  public async addVersionToRegistry(
    directory: string,
    remote: GithubRemote,
    version: string
  ): Promise<void> {
    logger.info(`Cloning "${remote.getRemoteString()}" to "${directory}"...`);
    await simpleGit()
      .silent(true)
      .clone(remote.getRemoteStringWithAuth(), directory);

    const canonical = this.registryConfig.canonicalName;
    if (!canonical) {
      throw new Error(
        '"canonical" value not found in the target configuration'
      );
    }

    let packageDirPath;
    if (this.registryConfig.type === RegistryPackageType.SDK) {
      packageDirPath = this.getSdkPackagePath(directory, canonical);
    } else if (this.registryConfig.type === RegistryPackageType.APP) {
      packageDirPath = this.getAppPackagePath(directory, canonical);
    } else {
      throw new Error(
        `Unknown registry package type: ${this.registryConfig.type}`
      );
    }

    const packageManifestPath = path.join(packageDirPath, 'latest.json');
    logger.debug('Reading the current configuration from "latest.json"...');
    const packageManifest =
      JSON.parse(fs.readFileSync(packageManifestPath).toString()) || {};

    // Additional check
    if (canonical !== packageManifest.canonical) {
      throw new Error(
        'Inconsistent canonical names found: check craft configuration and/or the release registry'
      );
    }

    // Update the manifest

    let updatedManifest: object;
    if (this.registryConfig.type === RegistryPackageType.SDK) {
      updatedManifest = { ...packageManifest, version };
    } else {
      const fileUrls = {};
      updatedManifest = { ...packageManifest, file_urls: fileUrls };
    }

    const versionFilePath = path.join(packageDirPath, `${version}.json`);
    if (fs.existsSync(versionFilePath)) {
      throw new Error(
        `Version file for "${version}" already exists. Aborting.`
      );
    }

    logger.debug(`Writing updated manifest to "${versionFilePath}"...`);
    fs.writeFileSync(
      versionFilePath,
      JSON.stringify(updatedManifest, undefined, '  ') + '\n' // tslint:disable-line:prefer-template
    );

    this.createSymlinks(versionFilePath, version);

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
  public async publish(version: string, _revision: string): Promise<any> {
    if (this.registryConfig.linkPrereleases && isPreviewRelease(version)) {
      logger.info('Preview release detected, skipping the target');
      return;
    }
    const username = await getAuthUsername(this.github);

    const remote = this.registryConfig.registryRemote;
    remote.setAuth(username, getGithubApiToken());

    await withTempDir(
      async directory => this.addVersionToRegistry(directory, remote, version),
      false, // FIXME
      'craft-release-registry-'
    );

    logger.info('Release registry updated');
  }
}

export function parseCanonical(canonicalName: string): string[] {
  const [registry, packageName] = canonicalName.split(':');
  if (!registry || !packageName) {
    throw new Error(
      `Cannot parse canonical name for the package: ${canonicalName}`
    );
  }
  const packageDirs = packageName.split('/');
  if (packageDirs.some(x => x.length === 0)) {
    throw new Error(
      `Cannot parse canonical name for the package: ${canonicalName}`
    );
  }
  return [registry].concat(packageName.split('/'));
}
