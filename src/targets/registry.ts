import { mapLimit } from 'async';
import * as Github from '@octokit/rest';
import simpleGit, { SimpleGit } from 'simple-git';

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
import {
  castChecksums,
  ChecksumEntry,
  getArtifactChecksums,
} from '../utils/checksum';
import {
  DEFAULT_REGISTRY_REMOTE,
  getPackageManifest,
  updateManifestSymlinks,
  RegistryPackageType,
} from '../utils/registry';
import { isDryRun } from '../utils/helpers';
import { filterAsync, withRetry } from '../utils/async';

/** "registry" target options */
export interface RegistryConfig {
  /** Type of the registry package */
  type: RegistryPackageType;
  /** Unique package cannonical name, including type and/or registry name */
  canonicalName: string;
  /** Should we create registry entries for pre-releases? */
  linkPrereleases?: boolean;
  /** URL template for file assets */
  urlTemplate?: string;
  /** Types of checksums to compute for artifacts */
  checksums?: ChecksumEntry[];
  /** Pattern that allows to skip the target if there's no matching file */
  onlyIfPresent?: RegExp;
}

interface LocalRegistry {
  dir: string;
  git: SimpleGit;
}

interface ArtifactData {
  url?: string;
  checksums?: {
    [key: string]: string;
  };
}

const BATCH_KEYS = {
  sdks: RegistryPackageType.SDK,
  apps: RegistryPackageType.APP,
};

/**
 * Target responsible for publishing to Sentry's release registry: https://github.com/getsentry/sentry-release-registry/
 */
export class RegistryTarget extends BaseTarget {
  /** Target name */
  public readonly name = 'registry';
  /** Git remote of the release registry */
  public readonly remote: GithubRemote;
  /** Target options */
  public readonly registryConfig: RegistryConfig[];
  /** Github client */
  public readonly github: Github;
  /** Github repo configuration */
  public readonly githubRepo: GithubGlobalConfig;

  public constructor(
    config: TargetConfig,
    artifactProvider: BaseArtifactProvider,
    githubRepo: GithubGlobalConfig
  ) {
    super(config, artifactProvider, githubRepo);
    const remote = this.config.remote;
    if (remote) {
      const [owner, repo] = remote.split('/', 2);
      this.remote = new GithubRemote(owner, repo);
    } else {
      this.remote = DEFAULT_REGISTRY_REMOTE;
    }
    this.github = getGithubClient();
    this.githubRepo = githubRepo;
    this.registryConfig = this.getRegistryConfig();
  }

  /**
   * Extracts Registry target options from the raw configuration.
   */
  public getRegistryConfig(): RegistryConfig[] {
    const items = Object.entries(BATCH_KEYS).flatMap(([key, type]) =>
      Object.entries(this.config[key] || {}).map(([canonicalName, conf]) => {
        const config = conf as Record<string, unknown>;
        const result = Object.assign(Object.create(null), config, {
          type,
          canonicalName,
        });

        if (typeof config.onlyIfPresent === 'string') {
          result.onlyIfPresent = stringToRegexp(config.onlyIfPresent);
        }

        return result;
      })
    );

    if (items.length === 0 && this.config.type) {
      this.logger.warn(
        'You are using a deprecated registry target config, please update.'
      );
      return [this.getLegacyRegistryConfig()];
    } else {
      return items;
    }
  }

  private getLegacyRegistryConfig(): RegistryConfig {
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
    registryConfig: RegistryConfig,
    manifest: { [key: string]: any },
    version: string,
    revision: string
  ): Promise<void> {
    if (!registryConfig.urlTemplate) {
      return;
    }

    const artifacts = await this.getArtifactsForRevision(revision);
    if (artifacts.length === 0) {
      this.logger.warn(
        'No artifacts found, not adding any links to the manifest'
      );
      return;
    }

    const fileUrls: { [_: string]: string } = {};
    for (const artifact of artifacts) {
      fileUrls[artifact.filename] = renderTemplateSafe(
        registryConfig.urlTemplate,
        {
          file: artifact.filename,
          revision,
          version,
        }
      );
    }
    this.logger.debug(
      `Writing file urls to the manifest, files found: ${artifacts.length}`
    );
    manifest.file_urls = fileUrls;
  }

  /**
   * Extends the artifact entry with additional URL and checksum information.
   *
   * The URL information is a string with the artifact filename, revision and
   * version, according to the template of the registry config. If no template
   * has been provided, no URL data is extended.
   *
   * Checksum information maps from the algorithm and format (following the
   * pattern `<algorithm>-<format>`) to the checksum of the provided artifact.
   * There must be at least one checksum to extend this information.
   *
   * @param artifact Artifact
   * @param version The new version
   * @param revision Git commit SHA to be published
   */
  public async getArtifactData(
    registryConfig: RegistryConfig,
    artifact: RemoteArtifact,
    version: string,
    revision: string
  ): Promise<ArtifactData> {
    const artifactData: ArtifactData = {};

    if (registryConfig.urlTemplate) {
      artifactData.url = renderTemplateSafe(registryConfig.urlTemplate, {
        file: artifact.filename,
        revision,
        version,
      });
    }

    if (registryConfig.checksums && registryConfig.checksums.length > 0) {
      artifactData.checksums = await getArtifactChecksums(
        registryConfig.checksums,
        artifact,
        this.artifactProvider
      );
    }

    return artifactData;
  }

  /**
   * Extends the artifact entries with additional information.
   *
   * Replaces the current file data on the package manifest with a new mapping
   * from artifact filenames to the artifact data. Note that this information
   * will be empty if no artifacts are found for the given revision.
   *
   * The artifact data contains URL and checksum information about the
   * artifact, provided by `getArtifactData`.
   *
   * @param packageManifest Package manifest
   * @param version The new version
   * @param revision Git commit SHA to be published
   */
  public async addFilesData(
    registryConfig: RegistryConfig,
    packageManifest: { [key: string]: any },
    version: string,
    revision: string
  ): Promise<void> {
    // Clear existing data
    delete packageManifest.files;

    if (
      !registryConfig.urlTemplate &&
      !(registryConfig.checksums && registryConfig.checksums.length > 0)
    ) {
      this.logger.warn(
        'No URL template or checksums, not adding any file data'
      );
      return;
    }

    const artifacts = await this.getArtifactsForRevision(revision);
    if (artifacts.length === 0) {
      this.logger.warn('No artifacts found, not adding any file data');
      return;
    }

    this.logger.info(
      'Adding extra data (checksums, download links) for available artifacts...'
    );

    const files: { [key: string]: any } = {};
    await mapLimit(artifacts, MAX_DOWNLOAD_CONCURRENCY, async artifact => {
      const fileData = await this.getArtifactData(
        registryConfig,
        artifact,
        version,
        revision
      );
      files[artifact.filename] = fileData;
    });

    packageManifest.files = files;
  }

  /**
   * Updates the local copy of the release registry by adding file data
   * (see `addFilesData`).
   *
   * Also, if it's a generic app, adds file links (note: legacy).
   *
   * @param packageManifest The package's manifest object
   * @param canonical The package's canonical name
   * @param version The new version
   * @param revision Git commit SHA to be published
   */
  public async getUpdatedManifest(
    registryConfig: RegistryConfig,
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
    if (registryConfig.type === RegistryPackageType.APP) {
      await this.addFileLinks(
        registryConfig,
        updatedManifest,
        version,
        revision
      );
    }

    // Add various file-related data
    await this.addFilesData(registryConfig, updatedManifest, version, revision);

    return updatedManifest;
  }

  /**
   * Commits the new version of the package to the release registry.
   *
   * @param localRepo The local checkout of the registry
   * @param version The new version
   * @param revision Git commit SHA to be published
   */
  private async updateVersionInRegistry(
    registryConfig: RegistryConfig,
    localRepo: LocalRegistry,
    version: string,
    revision: string
  ): Promise<void> {
    const canonicalName = registryConfig.canonicalName;
    const { versionFilePath, packageManifest } = await getPackageManifest(
      localRepo.dir,
      registryConfig.type,
      canonicalName,
      version
    );

    updateManifestSymlinks(
      await this.getUpdatedManifest(
        registryConfig,
        packageManifest,
        canonicalName,
        version,
        revision
      ),
      version,
      versionFilePath,
      packageManifest.version || undefined
    );
  }

  private async cloneRegistry(directory: string): Promise<SimpleGit> {
    const remote = this.remote;
    const username = await getAuthUsername(this.github);
    remote.setAuth(username, getGithubApiToken());

    const git = simpleGit(directory);
    this.logger.info(
      `Cloning "${remote.getRemoteString()}" to "${directory}"...`
    );
    await git.clone(remote.getRemoteStringWithAuth(), directory, [
      '--filter=tree:0',
      '--single-branch',
    ]);
    return git;
  }

  public async getValidItems(
    version: string,
    revision: string
  ): Promise<RegistryConfig[]> {
    return filterAsync(this.registryConfig, async registryConfig => {
      if (!registryConfig.linkPrereleases && isPreviewRelease(version)) {
        this.logger.info(
          `Preview release detected, skipping ${registryConfig.canonicalName}`
        );
        return false;
      }

      // If we have onlyIfPresent specified, check that we have any of matched files
      const onlyIfPresentPattern = registryConfig.onlyIfPresent;
      if (onlyIfPresentPattern) {
        const artifacts = await this.artifactProvider.filterArtifactsForRevision(
          revision,
          {
            includeNames: onlyIfPresentPattern,
          }
        );
        if (artifacts.length === 0) {
          this.logger.warn(
            `No files found that match "${onlyIfPresentPattern.toString()}", skipping the target.`
          );
          return false;
        }
      }
      return true;
    });
  }

  /**
   * Modifies/adds meta information regarding the package we are publishing
   */
  public async publish(version: string, revision: string): Promise<any> {
    const items = await this.getValidItems(version, revision);

    if (items.length === 0) {
      this.logger.warn('No suitable items found, bailing');
      return;
    }

    await withTempDir(
      async dir => {
        const localRepo = {
          dir,
          git: await this.cloneRegistry(dir),
        };
        await Promise.all(
          items.map(registryConfig =>
            this.updateVersionInRegistry(
              registryConfig,
              localRepo,
              version,
              revision
            )
          )
        );

        // Commit
        await localRepo.git
          .add(['.'])
          .commit(
            `craft: release "${this.githubRepo.repo}", version "${version}"`
          );
        // Push!
        if (!isDryRun()) {
          this.logger.info(`Pushing the changes...`);
          // Ensure we are still up to date with upstream
          await withRetry(() =>
            localRepo.git
              .pull('origin', 'master', ['--rebase'])
              .push('origin', 'master')
          );
        } else {
          this.logger.info('[dry-run] Not pushing the changes.');
        }
      },
      true,
      'craft-release-registry-'
    );

    this.logger.info('Release registry updated.');
  }
}
