import { mapLimit } from 'async';
import * as Github from '@octokit/rest';
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
import { renderTemplateSafe } from '../utils/strings';
import { isPreviewRelease } from '../utils/version';
import { stringToRegexp } from '../utils/filters';
import { BaseTarget } from './base';
import {
  RemoteArtifact,
  BaseArtifactProvider,
  MAX_DOWNLOAD_CONCURRENCY,
} from '../artifact_providers/base';
import { castChecksums, ChecksumEntry } from '../utils/checksum';
import { pushVersionToRegistry } from '../utils/gitTasks';

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

    const checksums = castChecksums(this.config.checksums);

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

    if (this.registryConfig.canonicalName === undefined) {
      throw new ConfigurationError(
        '"canonical" value not found in the registry configuration'
      );
    }
    const canonicalName: string = this.registryConfig.canonicalName;

    await withTempDir(
      async directory =>
        pushVersionToRegistry(
          this,
          directory,
          remote,
          version,
          revision,
          canonicalName
        ),
      true,
      'craft-release-registry-'
    );
    logger.info('Release registry updated');
  }
}
