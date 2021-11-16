import { Octokit, RestEndpointMethodTypes } from '@octokit/rest';
import { RequestError } from '@octokit/request-error';
import { readFileSync, promises, statSync } from 'fs';
import { basename } from 'path';
import { createHash } from 'crypto';

import { getConfiguration } from '../config';
import {
  ChangelogPolicy,
  GithubGlobalConfig,
  TargetConfig,
} from '../schemas/project_config';
import {
  Changeset,
  DEFAULT_CHANGELOG_PATH,
  findChangeset,
} from '../utils/changelog';
import { getGitHubClient } from '../utils/githubApi';
import { isDryRun } from '../utils/helpers';
import { isPreviewRelease, versionToTag } from '../utils/version';
import { BaseTarget } from './base';
import { BaseArtifactProvider } from '../artifact_providers/base';
import { logger } from '../logger';
import ora from 'ora';

/**
 * Default content type for GitHub release assets.
 */
export const DEFAULT_CONTENT_TYPE = 'application/octet-stream';

/**
 * Configuration options for the GitHub target.
 */
export interface GithubTargetConfig extends GithubGlobalConfig {
  /** Path to changelog inside the repository */
  changelog: string;
  /** Prefix that will be used to generate tag name */
  tagPrefix: string;
  /** Mark release as pre-release, if the version looks like a non-public release */
  previewReleases: boolean;
  /** Use annotated (not lightweight) tag */
  annotatedTag: boolean;
}

/**
 * An interface that represents a minimal GitHub release as returned by the
 * GitHub API.
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
 * Tag type as expected by the GitHub API.
 */
type GithubCreateTagType = 'commit' | 'tree' | 'blob';

type ReposListAssetsForReleaseResponseItem = RestEndpointMethodTypes['repos']['listReleaseAssets']['response']['data'][0];

interface OctokitError {
  resource: string;
  field: string;
  code:
    | 'missing'
    | 'missing_field'
    | 'invalid'
    | 'already_exists'
    | 'unprocessable'
    | 'custom';
  message?: string;
}
interface OctokitErrorResponse {
  message: string;
  errors: OctokitError[];
  documentation_url?: string;
}

/**
 * Target responsible for publishing releases on GitHub.
 */
export class GithubTarget extends BaseTarget {
  /** Target name */
  public readonly name = 'github';
  /** Target options */
  public readonly githubConfig: GithubTargetConfig;
  /** GitHub client */
  public readonly github: Octokit;
  /** GitHub repo configuration */
  public readonly githubRepo: GithubGlobalConfig;

  public constructor(
    config: TargetConfig,
    artifactProvider: BaseArtifactProvider,
    githubRepo: GithubGlobalConfig
  ) {
    super(config, artifactProvider, githubRepo);
    this.githubRepo = githubRepo;
    const owner = config.owner || githubRepo.owner;
    const repo = config.repo || githubRepo.repo;
    const changelog = getConfiguration().changelog || DEFAULT_CHANGELOG_PATH;

    this.githubConfig = {
      owner,
      repo,
      changelog,
      annotatedTag:
        this.config.annotatedTag === undefined || !!this.config.annotatedTag,
      previewReleases:
        this.config.previewReleases === undefined ||
        !!this.config.previewReleases,
      tagPrefix: this.config.tagPrefix || '',
    };
    this.github = getGitHubClient();
  }

  /**
   * Creates an annotated tag for the given revision.
   *
   * Unlike a lightweight tag (basically just a pointer to a commit), to
   * create an annotated tag we must create a tag object first, and then
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
    this.logger.debug(`Creating a tag object: "${tag}"`);
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
    this.logger.debug(`Creating a reference "${ref}" for object "${refSha}"`);
    try {
      await this.github.git.createRef({
        owner: this.githubConfig.owner,
        ref,
        repo: this.githubConfig.repo,
        sha: refSha,
      });
    } catch (e) {
      if (e instanceof Error && e.message.match(/reference already exists/i)) {
        this.logger.error(
          `Reference "${ref}" already exists. Does tag "${tag}" already exist?`
        );
      }
      throw e;
    }
  }

  /**
   * Gets an existing or creates a new release for the given version.
   *
   * The release name and description body is brought in from `changes`
   * respective tag, if present. Otherwise, the release name defaults to the
   * tag and the body to the commit it points to.
   *
   * @param version The version to release
   * @param revision Git commit SHA to be published
   * @param changes The changeset information for this release
   * @returns The newly created release
   */
  public async getOrCreateRelease(
    version: string,
    revision: string,
    changes?: Changeset
  ): Promise<GithubRelease> {
    const tag = versionToTag(version, this.githubConfig.tagPrefix);
    this.logger.info(`Git tag: "${tag}"`);
    const isPreview =
      this.githubConfig.previewReleases && isPreviewRelease(version);

    try {
      const response = await this.github.repos.getReleaseByTag({
        owner: this.githubConfig.owner,
        repo: this.githubConfig.repo,
        tag,
      });
      this.logger.warn(`Found the existing release for tag "${tag}"`);
      return response.data;
    } catch (e: any) {
      if (e.status !== 404) {
        throw e;
      }
      this.logger.debug(`Release for tag "${tag}" not found.`);
    }

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

    this.logger.debug(`Annotated tag: ${this.githubConfig.annotatedTag}`);
    if (!isDryRun()) {
      if (this.githubConfig.annotatedTag) {
        await this.createAnnotatedTag(version, revision, tag);
        // We've just created the tag, so "target_commitish" will not be used.
        createReleaseParams.target_commitish = '';
      }

      this.logger.info(
        `Creating a new ${
          isPreview ? '*preview* ' : ''
        }release for tag "${tag}"`
      );
      const created = await this.github.repos.createRelease(
        createReleaseParams
      );
      return created.data;
    } else {
      this.logger.info(`[dry-run] Not creating the release`);
      return {
        id: 0,
        tag_name: tag,
        upload_url: '',
      };
    }
  }

  public async getChangelog(version: string): Promise<Changeset> {
    let changelog;
    try {
      changelog = (
        await promises.readFile(this.githubConfig.changelog)
      ).toString();
    } catch (err) {
      logger.error('Cannot read changelog, moving on without one', err);
    }
    const changes = (changelog && findChangeset(changelog, version)) || {
      name: version,
      body: '',
    };
    this.logger.debug('Changes extracted from changelog.');
    this.logger.trace(changes);

    return changes;
  }

  /**
   * Deletes the provided asset from its respective release
   *
   * Can be also used to delete orphaned (unfinished) releases
   *
   * @param asset Asset to delete
   */
  public async deleteAsset(
    asset: ReposListAssetsForReleaseResponseItem
  ): Promise<boolean> {
    this.logger.debug(`Deleting asset: "${asset.name}"...`);
    if (isDryRun()) {
      this.logger.info(`[dry-run] Not uploading deleting "${asset.name}"`);
      return false;
    }

    return (
      (
        await this.github.repos.deleteReleaseAsset({
          asset_id: asset.id,
          ...this.githubConfig,
        })
      ).status === 204
    );
  }

  /**
   * Fetches a list of all assets for the given release
   *
   * The result includes unfinished asset uploads.
   *
   * @param release Release to fetch assets from
   */
  public async getAssetsForRelease(
    release_id: number
  ): Promise<ReposListAssetsForReleaseResponseItem[]> {
    const assetsResponse = await this.github.repos.listReleaseAssets({
      owner: this.githubConfig.owner,
      per_page: 50,
      release_id,
      repo: this.githubConfig.repo,
    });
    return assetsResponse.data;
  }

  /**
   * Deletes the asset with the given name from the specific release
   *
   * @param release Release object
   * @param assetName Asset name to be deleted
   */
  public async deleteAssetByName(
    release_id: number,
    assetName: string
  ): Promise<boolean> {
    const assets = await this.getAssetsForRelease(release_id);
    const assetToDelete = assets.find(({ name }) => name === assetName);
    if (!assetToDelete) {
      throw new Error(
        `No such asset with the name "${assetToDelete}". We have these instead: ${assets.map(
          ({ name }) => name
        )}`
      );
    }
    return this.deleteAsset(assetToDelete);
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
  ): Promise<string | undefined> {
    const contentTypeProcessed = contentType || DEFAULT_CONTENT_TYPE;
    const stats = statSync(path);
    const name = basename(path);
    const params = {
      ...this.githubConfig,
      headers: {
        'Content-Length': stats.size,
        'Content-Type': contentTypeProcessed,
      },
      release_id: release.id,
      name,
    };
    this.logger.trace('Upload parameters:', params);

    if (isDryRun()) {
      this.logger.info(`[dry-run] Not uploading asset "${name}"`);
      return;
    }

    const uploadSpinner = ora(
      `Uploading asset "${name}" to ${this.githubConfig.owner}/${this.githubConfig.repo}:${release.tag_name}`
    ).start();
    try {
      const file = readFileSync(path);
      const { url, size } = await this.handleGitHubUpload({
        ...params,
        // XXX: Octokit types this out as string, but in fact it also
        // accepts a `Buffer` here. In fact passing a string is not what we
        // want as we upload binary data.
        data: file as any,
      });

      uploadSpinner.text = `Verifying asset "${name}...`;
      if (size != stats.size) {
        throw new Error(
          `Uploaded asset size does not match local asset size for "${name} (${stats.size} != ${size}).`
        );
      }

      const remoteChecksum = await this.getRemoteChecksum(url);
      const localChecksum = createHash('md5').update(file).digest('hex');
      if (localChecksum !== remoteChecksum) {
        throw new Error(
          `Uploaded asset MD5 checksum does not match local asset checksum for "${name} (${localChecksum} != ${remoteChecksum})`
        );
      }
      return url;
    } catch (e) {
      uploadSpinner.fail(`Cannot upload asset "${name}".`);

      throw e;
    }
  }

  private async getRemoteChecksum(url: string): Promise<string> {
    // XXX: This is a bit hacky as we rely on two things:
    // 1. GitHub issuing a redirect to S3, where they store the artifacts,
    //    or at least pass those request headers unmodified to us
    // 2. AWS S3 using the MD5 hash of the file for its ETag cache header
    //    when we issue a HEAD request.
    let response;
    try {
      response = await this.github.request(`HEAD ${url}`, {
        headers: {
          // WARNING: You **MUST** pass this accept header otherwise you'll
          //          get a useless JSON API response back, instead of getting
          //          redirected to the raw file itself.
          //          And don't even think about using `browser_download_url`
          //          field as it is close to impossible to authenticate for
          //          that URL with a token and you'll lose hours getting 404s
          //          for private repos. Consider yourself warned. --xoxo BYK
          Accept: DEFAULT_CONTENT_TYPE,
        },
      });
    } catch (e) {
      throw new Error(
        `Cannot get asset on GitHub. Status: ${(e as any).status}\n` + e
      );
    }

    const etag = response.headers['etag'];
    if (etag && etag.length > 0) {
      // ETag header comes in quotes for some reason so strip those
      return etag.slice(1, -1);
    }

    return await this.md5FromUrl(url);
  }

  private async md5FromUrl(url: string): Promise<string> {
    this.logger.debug('Downloading asset from GitHub to check MD5 hash: ', url);
    let response;
    try {
      response = await this.github.request(`GET ${url}`, {
        headers: {
          Accept: DEFAULT_CONTENT_TYPE,
        },
      });
    } catch (e) {
      throw new Error(
        `Cannot download asset from GitHub. Status: ${(e as any).status}\n` + e
      );
    }

    return createHash('md5').update(Buffer.from(response.data)).digest('hex');
  }

  private async handleGitHubUpload(
    params: RestEndpointMethodTypes['repos']['uploadReleaseAsset']['parameters'],
    retries = 3
  ): Promise<{ url: string; size: number }> {
    try {
      return (await this.github.repos.uploadReleaseAsset(params)).data;
    } catch (err) {
      if (!(err instanceof RequestError)) {
        throw err;
      }

      // This usually happens when the upload gets interrupted somehow with a
      // 5xx error. See the docs here: https://git.io/JKZot
      const isAssetExistsError =
        err.status == 422 &&
        (err.response?.data as OctokitErrorResponse)?.errors?.some(
          ({ resource, code, field }) =>
            resource === 'ReleaseAsset' &&
            code === 'already_exists' &&
            field === 'name'
        );

      if (!isAssetExistsError) {
        throw err;
      }

      if (retries <= 0) {
        throw new Error(
          `Reached maximum retries for trying to upload asset "${params.name}.`
        );
      }

      logger.info('Got "asset already exists" error, deleting and retrying...');
      await this.deleteAssetByName(params.release_id, params.name);
      return this.handleGitHubUpload(params, --retries);
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
    const config = getConfiguration();
    let changelog;
    if (config.changelogPolicy !== ChangelogPolicy.None) {
      changelog = await this.getChangelog(version);
    }
    const release = await this.getOrCreateRelease(version, revision, changelog);

    const assets = await this.getAssetsForRelease(release.id);
    if (assets.length > 0) {
      this.logger.warn(
        'Existing assets found for the release, deleting them...'
      );
      if (isDryRun()) {
        this.logger.info('[dry-run] Not deleting assets.');
      } else {
        const results = await Promise.allSettled(
          assets.map(asset => this.deleteAsset(asset))
        );
        const failed = results.filter(
          ({ status }) => status === 'rejected'
        ) as PromiseRejectedResult[];
        if (failed.length === 0) {
          this.logger.debug(`Deleted ${assets.length} assets`);
        } else {
          this.logger.debug(
            'Failed to delete some assets:',
            failed.map(({ reason }) => reason)
          );
        }
      }
    }

    const artifacts = await this.getArtifactsForRevision(revision);
    const localArtifacts = await Promise.all(
      artifacts.map(async artifact => ({
        mimeType: artifact.mimeType,
        path: await this.artifactProvider.downloadArtifact(artifact),
      }))
    );

    await Promise.all(
      localArtifacts.map(({ path, mimeType }) =>
        this.uploadAsset(release, path, mimeType)
      )
    );
  }
}
