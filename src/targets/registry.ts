import * as fs from 'fs';
import * as path from 'path';

import { mapLimit } from 'async';
import * as Github from '@octokit/rest';
import * as simpleGit from 'simple-git/promise';
import * as _ from 'lodash';

import { getGlobalGithubConfig } from '../config';
import { logger as loggerRaw } from '../logger';
import { GithubGlobalConfig, TargetConfig } from '../schemas/project_config';
import { ConfigurationError, reportError } from '../utils/errors';
import { withTempDir } from '../utils/files';
import {
  getAuthUsername,
  getGithubApiToken,
  getGithubClient,
  GithubRemote,
} from '../utils/githubApi';
import { isDryRun } from '../utils/helpers';
import { renderTemplateSafe } from '../utils/strings';
import { HashAlgorithm, HashOutputFormat } from '../utils/system';
import {
  isPreviewRelease,
  parseVersion,
  versionGreaterOrEqualThan,
} from '../utils/version';
import { stringToRegexp } from '../utils/filters';
import { BaseTarget } from './base';
import {
  RemoteArtifact,
  BaseArtifactProvider,
  MAX_DOWNLOAD_CONCURRENCY,
} from '../artifact_providers/base';
import { parseCanonical } from 'src/utils/canonical';

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

/** Describes a checksum entry in the registry */
interface ChecksumEntry {
  /** Checksum (hash) algorithm */
  algorithm: HashAlgorithm;
  /** Checksum format */
  format: HashOutputFormat;
}

/** "registry" target options */
export interface RegistryConfig extends TargetConfig {
  /** Type of the registry package */
  type: RegistryPackageType;
  /** Unique package cannonical name, including type and/or registry name */
  canonicalName?: string;
  /** Git remote of the release registry */
  registryRemote: GithubRemote;
  /** Should we create registry entries for pre-releases? */
  linkPrereleases: boolean;
  /** URL template for file assets */
  urlTemplate?: string;
  /** Types of checksums to compute for artifacts */
  checksums: ChecksumEntry[];
  /** Pattern that allows to skip the target if there's no matching file */
  onlyIfPresent?: RegExp;
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

  public constructor(
    config: Record<string, any>,
    artifactProvider: BaseArtifactProvider
  ) {
    super(config, artifactProvider);
    this.github = getGithubClient();
    this.githubRepo = getGlobalGithubConfig();
    this.registryConfig = this.getRegistryConfig();
  }

  /**
   * Checks the provided checksums configuration
   *
   * Throws an error in case the configuration is incorrect
   * FIXME(tonyo): rewrite this with JSON schemas
   *
   * @param checksums Raw configuration
   */
  protected castChecksums(checksums: any[]): ChecksumEntry[] {
    if (!checksums) {
      return [];
    }
    if (!(checksums instanceof Array)) {
      throw new ConfigurationError(
        'Invalid type of "checksums": should be an array'
      );
    }
    const resultChecksums: ChecksumEntry[] = [];
    checksums.forEach(item => {
      if (typeof item !== 'object' || !item.algorithm || !item.format) {
        throw new ConfigurationError(
          `Invalid checksum type: ${JSON.stringify(item)}`
        );
      }
      // FIXME(tonyo): this is ugly as hell :(
      // This all has to be replaced with JSON schema
      if (
        !(Object as any).values(HashAlgorithm).includes(item.algorithm) ||
        !(Object as any).values(HashOutputFormat).includes(item.format)
      ) {
        throw new ConfigurationError(
          `Invalid checksum attributes: ${JSON.stringify(item)}`
        );
      }
      resultChecksums.push({ algorithm: item.algorithm, format: item.format });
    });
    return resultChecksums;
  }

  /**
   * Extracts Registry target options from the raw configuration
   */
  public getRegistryConfig(): RegistryConfig {
    const registryType = this.config.type;
    if (
      [RegistryPackageType.APP, RegistryPackageType.SDK].indexOf(
        registryType
      ) === -1
    ) {
      throw new ConfigurationError(
        `Invalid registry type specified: "${registryType}"`
      );
    }

    let urlTemplate;
    if (registryType === RegistryPackageType.APP) {
      urlTemplate = this.config.urlTemplate;
      if (urlTemplate && typeof urlTemplate !== 'string') {
        throw new ConfigurationError(
          `Invalid "urlTemplate" specified: ${urlTemplate}`
        );
      }
    }

    const releaseConfig = this.config.config;
    if (!releaseConfig) {
      throw new ConfigurationError(
        'Cannot find configuration dictionary for release registry'
      );
    }
    const canonicalName = releaseConfig.canonical;
    if (!canonicalName) {
      throw new ConfigurationError(
        'Canonical name not found in the configuration'
      );
    }

    const linkPrereleases = this.config.linkPrereleases || false;
    if (typeof linkPrereleases !== 'boolean') {
      throw new ConfigurationError('Invlaid type of "linkPrereleases"');
    }

    const checksums = this.castChecksums(this.config.checksums);

    const onlyIfPresentStr = this.config.onlyIfPresent || undefined;
    let onlyIfPresent;
    if (onlyIfPresentStr) {
      if (typeof onlyIfPresentStr !== 'string') {
        throw new ConfigurationError('Invalid type of "onlyIfPresent"');
      }
      onlyIfPresent = stringToRegexp(onlyIfPresentStr);
    }

    return {
      canonicalName,
      checksums,
      linkPrereleases,
      onlyIfPresent,
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
   * Create symbolic links to the new version file
   *
   * "latest.json" link is not updated if the new version is "older" (e.g., it's
   * a patch release for an older major version).
   *
   * @param versionFilePath Path to the new version file
   * @param newVersion The new version
   * @param oldVersion The previous latest version
   */
  public createSymlinks(
    versionFilePath: string,
    newVersion: string,
    oldVersion?: string
  ): void {
    const parsedNewVersion = parseVersion(newVersion) || undefined;
    if (!parsedNewVersion) {
      throw new ConfigurationError(
        `Cannot parse version: "${parsedNewVersion}"`
      );
    }
    const parsedOldVersion =
      (oldVersion ? parseVersion(oldVersion) : undefined) || undefined;
    const baseVersionName = path.basename(versionFilePath);
    const packageDir = path.dirname(versionFilePath);

    // link latest, but only if the new version is "newer"
    if (
      parsedOldVersion &&
      !versionGreaterOrEqualThan(parsedNewVersion, parsedOldVersion)
    ) {
      logger.warn(
        `Not updating the latest version file: current version is "${oldVersion}", new version is "${newVersion}"`
      );
    } else {
      logger.debug(
        `Changing symlink for "latest.json" from version "${oldVersion}" to "${newVersion}"`
      );
      this.forceSymlink(baseVersionName, path.join(packageDir, 'latest.json'));
    }

    // link major
    const majorVersionLink = `${parsedNewVersion.major}.json`;
    this.forceSymlink(baseVersionName, path.join(packageDir, majorVersionLink));

    // link minor
    const minorVersionLink = `${parsedNewVersion.major}.${parsedNewVersion.minor}.json`;
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
      throw new ConfigurationError(
        `Invalid canonical entry for an app: ${canonical}`
      );
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
      throw new ConfigurationError(
        `Unknown registry package type: ${this.registryConfig.type}`
      );
    }
  }

  /**
   * Adds file URLs to the manifest
   *
   * URL template is taken from "urlTemplate" configuration argument
   *
   * FIXME(tonyo): LEGACY function, left for compatibility, replaced by addFilesData
   *
   * @param manifest Package manifest
   * @param version The new version
   * @param revision Git commit SHA to be published
   */
  public async addFileLinks(
    manifest: { [key: string]: any },
    version: string,
    revision: string
  ): Promise<void> {
    if (!this.registryConfig.urlTemplate) {
      return;
    }

    const artifacts = await this.getArtifactsForRevision(revision);
    if (artifacts.length === 0) {
      logger.warn('No artifacts found, not adding any links to the manifest');
      return;
    }

    const fileUrls: { [_: string]: string } = {};
    for (const artifact of artifacts) {
      fileUrls[artifact.filename] = renderTemplateSafe(
        this.registryConfig.urlTemplate,
        {
          file: artifact.filename,
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
   * Extends the artifact entry with additional information
   *
   * Information and checksums and download URLs are added here
   *
   * @param artifact Artifact
   * @param version The new version
   * @param revision Git commit SHA to be published
   *
   */
  public async getArtifactData(
    artifact: RemoteArtifact,
    version: string,
    revision: string
  ): Promise<any> {
    const artifactData: any = {};

    if (this.registryConfig.urlTemplate) {
      artifactData.url = renderTemplateSafe(this.registryConfig.urlTemplate, {
        file: artifact.filename,
        revision,
        version,
      });
    }

    if (this.registryConfig.checksums.length > 0) {
      const fileChecksums: { [key: string]: string } = {};
      for (const checksumType of this.registryConfig.checksums) {
        const { algorithm, format } = checksumType;
        const checksum = await this.artifactProvider.getChecksum(
          artifact,
          algorithm,
          format
        );
        fileChecksums[`${algorithm}-${format}`] = checksum;
      }
      artifactData.checksums = fileChecksums;
    }
    return artifactData;
  }

  /**
   * Extends the artifact entries with additional information
   *
   * @param packageManifest Package manifest
   * @param version The new version
   * @param revision Git commit SHA to be published
   */
  public async addFilesData(
    packageManifest: { [key: string]: any },
    version: string,
    revision: string
  ): Promise<void> {
    // Clear existing data
    delete packageManifest.files;

    const artifacts = await this.getArtifactsForRevision(revision);
    if (artifacts.length === 0) {
      logger.warn('No artifacts found, not adding any file data');
      return;
    }

    logger.info(
      'Adding extra data (checksums, download links) for available artifacts...'
    );
    const files: { [key: string]: any } = {};

    await mapLimit(artifacts, MAX_DOWNLOAD_CONCURRENCY, async artifact => {
      const fileData = await this.getArtifactData(artifact, version, revision);
      if (!_.isEmpty(fileData)) {
        files[artifact.filename] = fileData;
      }
    });

    if (!_.isEmpty(files)) {
      packageManifest.files = files;
    }
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
    packageManifest: { [key: string]: any },
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

    // Add file links if it's a generic app (legacy)
    if (this.registryConfig.type === RegistryPackageType.APP) {
      await this.addFileLinks(updatedManifest, version, revision);
    }

    // Add various file-related data
    await this.addFilesData(updatedManifest, version, revision);

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
      reportError(`Version file for "${version}" already exists. Aborting.`);
    }

    const packageManifestPath = path.join(packageDirPath, 'latest.json');
    logger.debug('Reading the current configuration from "latest.json"...');
    const packageManifest =
      JSON.parse(fs.readFileSync(packageManifestPath).toString()) || {};
    const previousVersion = packageManifest.version || undefined;

    const updatedManifest = await this.getUpdatedManifest(
      packageManifest,
      canonical,
      version,
      revision
    );

    const manifestString = JSON.stringify(updatedManifest, undefined, 2) + '\n';
    logger.debug('Updated manifest', manifestString);
    logger.debug(`Writing updated manifest to "${versionFilePath}"...`);
    fs.writeFileSync(versionFilePath, manifestString);

    this.createSymlinks(versionFilePath, version, previousVersion);
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
      throw new ConfigurationError(
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
    if (!isDryRun()) {
      await git.push('origin', 'master');
    } else {
      logger.info('[dry-run] Not pushing the branch.');
    }
  }

  /**
   * Pushes an archive with static HTML web assets to the configured branch
   */
  public async publish(version: string, revision: string): Promise<any> {
    if (!this.registryConfig.linkPrereleases && isPreviewRelease(version)) {
      logger.info('Preview release detected, skipping the target');
      return undefined;
    }

    // If we have onlyIfPresent specified, check that we have any of matched files
    const onlyIfPresentPattern = this.registryConfig.onlyIfPresent;
    if (onlyIfPresentPattern) {
      const artifacts = await this.artifactProvider.filterArtifactsForRevision(
        revision,
        {
          includeNames: onlyIfPresentPattern,
        }
      );
      if (artifacts.length === 0) {
        logger.warn(
          `No files found that match "${onlyIfPresentPattern.toString()}", skipping the target.`
        );
        return undefined;
      }
    }

    const remote = this.registryConfig.registryRemote;
    const username = await getAuthUsername(this.github);
    remote.setAuth(username, getGithubApiToken());

    await withTempDir(
      async directory =>
        this.pushVersionToRegistry(directory, remote, version, revision),
      true,
      'craft-release-registry-'
    );
    logger.info('Release registry updated');
  }
}
