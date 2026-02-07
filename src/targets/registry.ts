import { mapLimit } from 'async';
import { Octokit } from '@octokit/rest';
import type { SimpleGit } from 'simple-git';

import {
  GitHubGlobalConfig,
  TargetConfig,
  TypedTargetConfig,
} from '../schemas/project_config';
import { ConfigurationError, reportError } from '../utils/errors';
import { withTempDir } from '../utils/files';
import {
  getGitHubApiToken,
  getGitHubClient,
  GitHubRemote,
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
  InitialManifestData,
} from '../utils/registry';
import { cloneRepo } from '../utils/git';
import { filterAsync, withRetry } from '../utils/async';

/** Fields on the registry target config accessed at runtime */
interface RegistryTargetConfigFields extends Record<string, unknown> {
  remote?: string;
  type?: RegistryPackageType;
  urlTemplate?: string;
  config?: { canonical?: string };
  linkPrereleases?: boolean;
  checksums?: unknown[];
  onlyIfPresent?: string;
  sdks?: Record<string, unknown>;
  apps?: Record<string, unknown>;
}

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
  /** Human-readable name for new packages */
  name?: string;
  /** Link to package registry (PyPI, npm, etc.) */
  packageUrl?: string;
  /** Link to main documentation */
  mainDocsUrl?: string;
  /** Link to API documentation */
  apiDocsUrl?: string;
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
  public readonly remote: GitHubRemote;
  /** Target options */
  public readonly registryConfig: RegistryConfig[];
  /** GitHub client */
  public readonly github: Octokit;
  /** GitHub repo configuration */
  public readonly githubRepo: GitHubGlobalConfig;

  public constructor(
    config: TargetConfig,
    artifactProvider: BaseArtifactProvider,
    githubRepo: GitHubGlobalConfig,
  ) {
    super(config, artifactProvider, githubRepo);
    const typedConfig = this
      .config as TypedTargetConfig<RegistryTargetConfigFields>;
    const remote = typedConfig.remote;
    if (remote) {
      const [owner, repo] = remote.split('/', 2);
      this.remote = new GitHubRemote(owner, repo);
    } else {
      this.remote = DEFAULT_REGISTRY_REMOTE;
    }
    this.github = getGitHubClient();
    this.githubRepo = githubRepo;
    this.registryConfig = this.getRegistryConfig();
  }

  /**
   * Extracts Registry target options from the raw configuration.
   */
  public getRegistryConfig(): RegistryConfig[] {
    const typedConfig = this
      .config as TypedTargetConfig<RegistryTargetConfigFields>;
    const items = Object.entries(BATCH_KEYS).flatMap(([key, type]) =>
      Object.entries(
        (typedConfig[key as keyof RegistryTargetConfigFields] as
          | Record<string, unknown>
          | undefined) || {},
      ).map(([canonicalName, conf]) => {
        const config = conf as RegistryConfig | null;
        const result = Object.assign(Object.create(null), config, {
          type,
          canonicalName,
        });

        if (typeof config?.onlyIfPresent === 'string') {
          result.onlyIfPresent = stringToRegexp(config.onlyIfPresent);
        }

        return result;
      }),
    );

    if (items.length === 0 && typedConfig.type) {
      this.logger.warn(
        'You are using a deprecated registry target config, please update.',
      );
      return [this.getLegacyRegistryConfig()];
    } else {
      return items;
    }
  }

  private getLegacyRegistryConfig(): RegistryConfig {
    const typedConfig = this
      .config as TypedTargetConfig<RegistryTargetConfigFields>;
    const registryType = typedConfig.type;
    if (
      !registryType ||
      [RegistryPackageType.APP, RegistryPackageType.SDK].indexOf(
        registryType,
      ) === -1
    ) {
      throw new ConfigurationError(
        `Invalid registry type specified: "${registryType}"`,
      );
    }

    let urlTemplate: string | undefined;
    if (registryType === RegistryPackageType.APP) {
      urlTemplate = typedConfig.urlTemplate;
      if (urlTemplate && typeof urlTemplate !== 'string') {
        throw new ConfigurationError(
          `Invalid "urlTemplate" specified: ${urlTemplate}`,
        );
      }
    }

    const releaseConfig = typedConfig.config;
    if (!releaseConfig) {
      throw new ConfigurationError(
        'Cannot find configuration dictionary for release registry',
      );
    }
    const canonicalName = releaseConfig.canonical;
    if (!canonicalName) {
      throw new ConfigurationError(
        'Canonical name not found in the configuration',
      );
    }

    const linkPrereleases = typedConfig.linkPrereleases || false;
    if (typeof linkPrereleases !== 'boolean') {
      throw new ConfigurationError('Invlaid type of "linkPrereleases"');
    }

    const checksums = castChecksums(typedConfig.checksums as unknown[]);

    const onlyIfPresentStr = typedConfig.onlyIfPresent || undefined;
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
    revision: string,
  ): Promise<void> {
    if (!registryConfig.urlTemplate) {
      return;
    }

    const artifacts = await this.getArtifactsForRevision(revision);
    if (artifacts.length === 0) {
      this.logger.warn(
        'No artifacts found, not adding any links to the manifest',
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
        },
      );
    }
    this.logger.debug(
      `Writing file urls to the manifest, files found: ${artifacts.length}`,
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
    revision: string,
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
        this.artifactProvider,
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
    revision: string,
  ): Promise<void> {
    // Clear existing data
    delete packageManifest.files;

    if (
      !registryConfig.urlTemplate &&
      !(registryConfig.checksums && registryConfig.checksums.length > 0)
    ) {
      this.logger.warn(
        'No URL template or checksums, not adding any file data',
      );
      return;
    }

    const artifacts = await this.getArtifactsForRevision(revision);
    if (artifacts.length === 0) {
      this.logger.warn('No artifacts found, not adding any file data');
      return;
    }

    this.logger.info(
      'Adding extra data (checksums, download links) for available artifacts...',
    );

    const files: { [key: string]: any } = {};
    await mapLimit(
      artifacts,
      MAX_DOWNLOAD_CONCURRENCY,
      async (artifact: RemoteArtifact) => {
        const fileData = await this.getArtifactData(
          registryConfig,
          artifact,
          version,
          revision,
        );
        files[artifact.filename] = fileData;
      },
    );

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
    revision: string,
  ): Promise<any> {
    // Additional check
    if (canonical !== packageManifest.canonical) {
      reportError(
        `Canonical name in "craft" config ("${canonical}") is inconsistent with ` +
          `the one in package manifest ("${packageManifest.canonical}")`,
      );
    }
    // Update the manifest
    const updatedManifest: {
      version: string;
      created_at: string;
      [key: string]: any;
    } = {
      ...packageManifest,
      version,
      created_at: new Date().toISOString(),
    };

    // Apply config fields - these always override existing values when specified
    // This allows repo maintainers to update metadata in their config
    const { owner, repo } = this.githubRepo;
    updatedManifest.repo_url = `https://github.com/${owner}/${repo}`;
    if (registryConfig.name !== undefined) {
      updatedManifest.name = registryConfig.name;
    }
    if (registryConfig.packageUrl !== undefined) {
      updatedManifest.package_url = registryConfig.packageUrl;
    }
    if (registryConfig.mainDocsUrl !== undefined) {
      updatedManifest.main_docs_url = registryConfig.mainDocsUrl;
    }
    if (registryConfig.apiDocsUrl !== undefined) {
      updatedManifest.api_docs_url = registryConfig.apiDocsUrl;
    }

    // Add file links if it's a generic app (legacy)
    if (registryConfig.type === RegistryPackageType.APP) {
      await this.addFileLinks(
        registryConfig,
        updatedManifest,
        version,
        revision,
      );
    }

    // Add various file-related data
    await this.addFilesData(registryConfig, updatedManifest, version, revision);

    return updatedManifest;
  }

  /**
   * Builds the initial manifest data for creating a new package in the registry.
   *
   * @param registryConfig The registry configuration
   * @returns The initial manifest data
   */
  private buildInitialManifestData(
    registryConfig: RegistryConfig,
  ): InitialManifestData {
    const { owner, repo } = this.githubRepo;
    return {
      canonical: registryConfig.canonicalName,
      repoUrl: `https://github.com/${owner}/${repo}`,
      name: registryConfig.name,
      packageUrl: registryConfig.packageUrl,
      mainDocsUrl: registryConfig.mainDocsUrl,
      apiDocsUrl: registryConfig.apiDocsUrl,
    };
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
    revision: string,
  ): Promise<void> {
    const canonicalName = registryConfig.canonicalName;
    const initialManifestData = this.buildInitialManifestData(registryConfig);
    const { versionFilePath, packageManifest } = await getPackageManifest(
      localRepo.dir,
      registryConfig.type,
      canonicalName,
      version,
      initialManifestData,
    );

    const newManifest = await this.getUpdatedManifest(
      registryConfig,
      packageManifest,
      canonicalName,
      version,
      revision,
    );

    await updateManifestSymlinks(
      newManifest,
      version,
      versionFilePath,
      packageManifest.version || undefined,
    );
  }

  private async cloneRegistry(directory: string): Promise<SimpleGit> {
    const remote = this.remote;
    remote.setAuth(getGitHubApiToken());

    this.logger.info(
      `Cloning "${remote.getRemoteString()}" to "${directory}"...`,
    );
    return cloneRepo(remote.getRemoteStringWithAuth(), directory, [
      '--filter=tree:0',
      '--single-branch',
    ]);
  }

  public async getValidItems(
    version: string,
    revision: string,
  ): Promise<RegistryConfig[]> {
    return filterAsync(this.registryConfig, async registryConfig => {
      if (!registryConfig.linkPrereleases && isPreviewRelease(version)) {
        this.logger.info(
          `Preview release detected, skipping ${registryConfig.canonicalName}`,
        );
        return false;
      }

      // If we have onlyIfPresent specified, check that we have any of matched files
      const onlyIfPresentPattern = registryConfig.onlyIfPresent;
      if (onlyIfPresentPattern) {
        const artifacts =
          await this.artifactProvider.filterArtifactsForRevision(revision, {
            includeNames: onlyIfPresentPattern,
          });
        if (artifacts.length === 0) {
          this.logger.warn(
            `No files found that match "${onlyIfPresentPattern.toString()}", skipping the target.`,
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
              revision,
            ),
          ),
        );

        await localRepo.git
          .add(['.'])
          .commit(
            `craft: release "${this.githubRepo.repo}", version "${version}"`,
          );
        this.logger.info(`Pushing the changes...`);
        // Ensure we are still up to date with upstream
        await withRetry(() =>
          localRepo.git
            .pull('origin', 'master', ['--rebase'])
            .push('origin', 'master'),
        );
      },
      true,
      'craft-release-registry-',
    );

    this.logger.info('Release registry updated.');
  }
}
