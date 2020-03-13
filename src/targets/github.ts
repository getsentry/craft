import * as Github from '@octokit/rest';
import { shouldPerform, isDryRun } from 'dryrun';
import { createReadStream, statSync } from 'fs';
import { basename } from 'path';

import { getConfiguration, getGlobalGithubConfig } from '../config';
import { logger as loggerRaw } from '../logger';
import { GithubGlobalConfig, TargetConfig } from '../schemas/project_config';
import { DEFAULT_CHANGELOG_PATH, findChangeset } from '../utils/changes';
import {
  getFile,
  getGithubClient,
  HTTP_RESPONSE_5XX,
  HTTP_UNPROCESSABLE_ENTITY,
  retryHttp,
} from '../utils/githubApi';
import { isPreviewRelease, versionToTag } from '../utils/version';
import { BaseTarget } from './base';
import { BaseArtifactProvider } from '../artifact_providers/base';

const logger = loggerRaw.withScope('[github]');

/**
 * Default content type for GitHub release assets
 */
export const DEFAULT_CONTENT_TYPE = 'application/octet-stream';

/**
 * Configuration options for the Github target
 */
export interface GithubTargetConfig extends TargetConfig, GithubGlobalConfig {
  /** Path to changelon inside the repository */
  changelog: string;
  /** Prefix that will be used to generate tag name */
  tagPrefix: string;
  /** Mark releases as pre-release, if the version looks like a non-public release */
  previewReleases: boolean;
  /** Use annotated (not lightweight) tag */
  annotatedTag: boolean;
}

/**
 * An interface that represents a minimal Github release as returned by
 * Github API.
 */
interface GithubRelease {
  /** Release id */
  id: number;
  /** Tag name */
  tag_name: string;
  /** Upload URL */
  upload_url: string;
}

/**
 * Tag type as used in GitdataCreateTagParams from Github API
 */
type GithubCreateTagType = 'commit' | 'tree' | 'blob';

/**
 * Target responsible for publishing releases on Github
 */
export class GithubTarget extends BaseTarget {
  /** Target name */
  public readonly name: string = 'github';
  /** Target options */
  public readonly githubConfig: GithubTargetConfig;
  /** Github client */
  public readonly github: Github;

  public constructor(config: any, artifactProvider: BaseArtifactProvider) {
    super(config, artifactProvider);
    this.githubConfig = {
      ...getGlobalGithubConfig(),
      annotatedTag:
        this.config.annotatedTag === undefined || !!this.config.annotatedTag,
      changelog: getConfiguration().changelog || '',
      previewReleases:
        this.config.previewReleases === undefined ||
        !!this.config.previewReleases,
      tagPrefix: this.config.tagPrefix || '',
    };
    this.github = getGithubClient();
  }

  /**
   * Creates an annotated tag for the given revision
   *
   * Unlike a lightweight tag (basically just a pointer to a commit), to
   * create an annotateg tag we must create a tag object first, and then
   * create a reference to it manually.
   *
   * @param version The version to release
   * @param revision Git commit SHA to be published
   * @param tag Tag to create
   * @returns The newly created release
   */
  public async createAnnotatedTag(
    version: string,
    revision: string,
    tag: string
  ): Promise<void> {
    logger.debug(`Creating a tag object: "${tag}"`);
    const createTagParams = {
      message: `Tag for release: ${version}`,
      object: revision,
      owner: this.githubConfig.owner,
      repo: this.githubConfig.repo,
      tag,
      type: 'commit' as GithubCreateTagType,
    };
    const tagCreatedResponse = await this.github.git.createTag(createTagParams);

    const ref = `refs/tags/${tag}`;
    const refSha = tagCreatedResponse.data.sha;
    logger.debug(`Creating a reference "${ref}" for object "${refSha}"`);
    try {
      await this.github.git.createRef({
        owner: this.githubConfig.owner,
        ref,
        repo: this.githubConfig.repo,
        sha: refSha,
      });
    } catch (e) {
      if (e.message && e.message.match(/reference already exists/i)) {
        logger.error(
          `Reference "${ref}" already exists. Does tag "${tag}" already exist?`
        );
      }
      throw e;
    }
  }

  /**
   * Gets an existing or creates a new release for the given version
   *
   * The release name and description body is loaded from CHANGELOG.md in the
   * respective tag, if present. Otherwise, the release name defaults to the
   * tag and the body to the commit it points to.
   *
   * @param version The version to release
   * @param revision Git commit SHA to be published
   * @returns The newly created release
   */
  public async getOrCreateRelease(
    version: string,
    revision: string
  ): Promise<GithubRelease> {
    const tag = versionToTag(version, this.githubConfig.tagPrefix);
    logger.info(`Git tag: "${tag}"`);
    const isPreview =
      this.githubConfig.previewReleases && isPreviewRelease(version);

    try {
      const response = await this.github.repos.getReleaseByTag({
        owner: this.githubConfig.owner,
        repo: this.githubConfig.repo,
        tag,
      });
      logger.warn(`Found the existing release for tag "${tag}"`);
      return response.data;
    } catch (e) {
      if (e.status !== 404) {
        throw e;
      }
      logger.debug(`Release for tag "${tag}" not found.`);
    }

    // Release hasn't been found, so create one
    const changelog = await getFile(
      this.github,
      this.githubConfig.owner,
      this.githubConfig.repo,
      this.githubConfig.changelog || DEFAULT_CHANGELOG_PATH,
      revision
    );
    const changes = (changelog && findChangeset(changelog, tag)) || {};
    logger.debug('Changes extracted from changelog: ', JSON.stringify(changes));

    const createReleaseParams = {
      draft: false,
      name: tag,
      owner: this.githubConfig.owner,
      prerelease: isPreview,
      repo: this.githubConfig.repo,
      tag_name: tag,
      target_commitish: revision,
      ...changes,
    };

    logger.debug(`Annotated tag: ${this.githubConfig.annotatedTag}`);
    if (shouldPerform()) {
      if (this.githubConfig.annotatedTag) {
        await this.createAnnotatedTag(version, revision, tag);
        // We've just created the tag, so "target_commitish" will not be used.
        createReleaseParams.target_commitish = '';
      }

      logger.info(
        `Creating a new ${
          isPreview ? '*preview* ' : ''
        }release for tag "${tag}"`
      );
      const created = await this.github.repos.createRelease(
        createReleaseParams
      );
      return created.data;
    } else {
      logger.info(`[dry-run] Not creating the release`);
      return {
        id: 0,
        tag_name: tag,
        upload_url: '',
      };
    }
  }

  /**
   * Deletes the provided asset from its respective release
   *
   * Can be also used to delete orphaned (unfinished) releases
   *
   * @param asset Asset to delete
   */
  public async deleteAsset(
    asset: Github.ReposListAssetsForReleaseResponseItem
  ): Promise<void> {
    if (isDryRun()) {
      logger.debug(`[dry-run] Not deleting the asset: "${asset.name}"`);
      return;
    }

    logger.debug(`Deleting asset: "${asset.name}"...`);
    return retryHttp(async () =>
      this.github.repos.deleteReleaseAsset({
        asset_id: asset.id,
        owner: this.githubConfig.owner,
        repo: this.githubConfig.repo,
      })
    ) as any;
  }

  /**
   * Delete all provided assets
   *
   * @param assets A list of assets to delete
   */
  public async deleteAssets(
    assets: Github.ReposListAssetsForReleaseResponseItem[]
  ): Promise<void> {
    // Doing it serially, just in case
    for (const asset of assets) {
      await this.deleteAsset(asset);
    }
  }

  /**
   * Fetches a list of all assets for the given release
   *
   * The result includes unfinshed asset uploads.
   *
   * @param release Release to fetch assets from
   */
  public async getAssetsForRelease(
    release: GithubRelease
  ): Promise<Github.ReposListAssetsForReleaseResponseItem[]> {
    const listAssets = async () =>
      this.github.repos.listAssetsForRelease({
        owner: this.githubConfig.owner,
        per_page: 50,
        release_id: release.id,
        repo: this.githubConfig.repo,
      });
    const assetsResponse = await retryHttp(listAssets);
    return assetsResponse.data;
  }

  /**
   * Deletes assets with the given name from the specific release
   *
   * @param release Release object
   * @param name Assets with this name will be deleted
   */
  public async deleteAssetsByFilename(
    release: GithubRelease,
    name: string
  ): Promise<void> {
    const assets = await this.getAssetsForRelease(release);
    for (const asset of assets) {
      if (asset.name === name) {
        await this.deleteAsset(asset);
      }
    }
  }

  /**
   * Uploads the file from the provided path to the specific release
   *
   * @param release Release object
   * @param path Filesystem (local) path of the file to upload
   * @param contentType Optional content-type for uploading
   */
  public async uploadAsset(
    release: GithubRelease,
    path: string,
    contentType?: string
  ): Promise<any> {
    const contentTypeProcessed = contentType || DEFAULT_CONTENT_TYPE;
    const stats = statSync(path);
    const name = basename(path);
    const params = {
      'Content-Length': stats.size,
      'Content-Type': contentTypeProcessed,
      file: createReadStream(path),
      headers: {
        'content-length': stats.size,
        'content-type': contentTypeProcessed,
      },
      id: release.id,
      name,
      url: release.upload_url,
    };
    logger.debug('Upload parameters:', JSON.stringify(params));
    logger.info(
      `Uploading asset "${name}" to ${this.githubConfig.owner}/${this.githubConfig.repo}:${release.tag_name}`
    );
    if (shouldPerform()) {
      try {
        await retryHttp(
          async () => this.github.repos.uploadReleaseAsset(params),
          {
            cleanupFn: async () => {
              logger.debug('Cleaning up before the next retry...');
              return this.deleteAssetsByFilename(release, name);
            },
            retries: 5,
            retryCodes: [HTTP_RESPONSE_5XX, HTTP_UNPROCESSABLE_ENTITY],
          }
        );
      } catch (e) {
        logger.error(`Cannot upload asset "${name}".`);
        throw e;
      }
      logger.log(`Uploaded asset "${name}".`);
    } else {
      logger.info(`[dry-run] Not uploading asset "${name}"`);
    }
  }

  /**
   * Creates a new GitHub release and publish all available artifacts.
   *
   * It also creates a tag if it doesn't exist
   *
   * @param version New version to be released
   * @param revision Git commit SHA to be published
   */
  public async publish(version: string, revision: string): Promise<any> {
    logger.info(`Target "${this.name}": publishing version "${version}"...`);
    logger.debug(`Revision: ${revision}`);
    const release = await this.getOrCreateRelease(version, revision);
    const assets = await this.getAssetsForRelease(release);
    if (assets.length > 0) {
      logger.warn('Existing assets found for the release, deleting them...');
      await this.deleteAssets(assets);
      logger.debug(`Deleted ${assets.length} assets`);
    }

    const artifacts = await this.getArtifactsForRevision(revision);
    await Promise.all(
      artifacts.map(async artifact => {
        const path = await this.artifactProvider.downloadArtifact(artifact);
        return this.uploadAsset(release, path, artifact.mimeType);
      })
    );
  }
}
