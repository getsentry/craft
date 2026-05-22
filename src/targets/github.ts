import { Octokit, RestEndpointMethodTypes } from '@octokit/rest';
import { createReadStream, promises, statSync } from 'fs';
import { basename } from 'path';

import { getConfiguration } from '../config';
import {
  ChangelogPolicy,
  GitHubGlobalConfig,
  TargetConfig,
  TypedTargetConfig,
} from '../schemas/project_config';
import {
  Changeset,
  DEFAULT_CHANGELOG_PATH,
  findChangeset,
} from '../utils/changelog';
import { getGitHubClient } from '../utils/githubApi';
import { isDryRun } from '../utils/helpers';
import { safeExec } from '../utils/dryRun';
import {
  isPreviewRelease,
  parseVersion,
  SemVer,
  versionGreaterOrEqualThan,
  versionToTag,
} from '../utils/version';
import { BaseTarget } from './base';
import { BaseArtifactProvider } from '../artifact_providers/base';
import { logger } from '../logger';

/**
 * Default content type for GitHub release assets.
 */
export const DEFAULT_CONTENT_TYPE = 'application/octet-stream';

/**
 * Maximum number of characters allowed in a GitHub release body.
 * @see https://docs.github.com/rest/releases/releases#create-a-release
 */
export const GITHUB_RELEASE_BODY_MAX = 125_000;

/** GitHub target configuration fields */
interface GitHubConfigFields extends Record<string, unknown> {
  owner?: string;
  repo?: string;
  tagPrefix?: string;
  tagOnly?: boolean;
  previewReleases?: boolean;
  floatingTags?: string[];
}

/**
 * Configuration options for the GitHub target.
 */
export interface GitHubTargetConfig extends GitHubGlobalConfig {
  /** Path to changelog inside the repository */
  changelog: string;
  /** Prefix that will be used to generate tag name */
  tagPrefix: string;
  /** Mark release as pre-release, if the version looks like a non-public release */
  previewReleases: boolean;
  /** Do not create a full GitHub release, only push a git tag */
  tagOnly: boolean;
  /**
   * Floating tags to create/update when publishing a release.
   * Supports placeholders: {major}, {minor}, {patch}
   * Example: "v{major}" creates a "v2" tag for version "2.15.0"
   */
  floatingTags: string[];
}

/**
 * An interface that represents a minimal GitHub release as returned by the
 * GitHub API.
 */
interface GitHubRelease {
  /** Release id */
  id: number;
  /** Tag name */
  tag_name: string;
  /** Upload URL */
  upload_url: string;
  /** Whether this is a draft release */
  draft?: boolean;
}

type ReposListAssetsForReleaseResponseItem =
  RestEndpointMethodTypes['repos']['listReleaseAssets']['response']['data'][0];

/**
 * Target responsible for publishing releases on GitHub.
 */
export class GitHubTarget extends BaseTarget {
  /** Target name */
  public readonly name = 'github';
  /** Target options */
  public readonly githubConfig: GitHubTargetConfig;
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
    this.githubRepo = githubRepo;
    const typedConfig = this.config as TypedTargetConfig<GitHubConfigFields>;
    const owner = typedConfig.owner || githubRepo.owner;
    const repo = typedConfig.repo || githubRepo.repo;
    const configChangelog = getConfiguration().changelog;
    const changelog =
      typeof configChangelog === 'string'
        ? configChangelog
        : configChangelog?.filePath || DEFAULT_CHANGELOG_PATH;

    this.githubConfig = {
      owner,
      repo,
      changelog,
      previewReleases:
        typedConfig.previewReleases === undefined ||
        !!typedConfig.previewReleases,
      tagPrefix: typedConfig.tagPrefix || '',
      tagOnly: !!typedConfig.tagOnly,
      floatingTags: typedConfig.floatingTags || [],
    };
    this.github = getGitHubClient();
  }

  /**
   * Builds a permalink URL to the changelog file in the repository at a
   * specific revision, optionally anchored to the line range of the changeset.
   */
  private buildChangelogPermalink(
    revision: string,
    changes?: Changeset,
  ): string {
    const { owner, repo, changelog } = this.githubConfig;
    let url = `https://github.com/${owner}/${repo}/blob/${revision}/${changelog}`;
    if (changes?.startLine != null && changes?.endLine != null) {
      url += `#L${changes.startLine}-L${changes.endLine}`;
    }
    return url;
  }

  /**
   * If the release body exceeds GitHub's maximum, truncate it at the last
   * line boundary that fits and append a link to the full changelog.
   */
  private truncateBody(
    body: string,
    revision: string,
    changes?: Changeset,
  ): string {
    if (body.length <= GITHUB_RELEASE_BODY_MAX) {
      return body;
    }

    const permalink = this.buildChangelogPermalink(revision, changes);
    const footer = `\n\n---\n_This changelog has been truncated. See the [full changelog](${permalink}) for all changes._`;
    const maxLength = GITHUB_RELEASE_BODY_MAX - footer.length;

    // Truncate at the last newline that fits so we don't cut a line in half
    const truncateAt = body.lastIndexOf('\n', maxLength);
    const truncated = body.substring(
      0,
      truncateAt > 0 ? truncateAt : maxLength,
    );

    this.logger.warn(
      `Release body exceeds GitHub limit (${body.length} > ${GITHUB_RELEASE_BODY_MAX} chars). Truncating and linking to full changelog.`,
    );

    return truncated + footer;
  }

  /**
   * Create a draft release for the given version.
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
  public async createDraftRelease(
    version: string,
    revision: string,
    changes?: Changeset,
  ): Promise<GitHubRelease> {
    const tag = versionToTag(version, this.githubConfig.tagPrefix);
    this.logger.info(`Git tag: "${tag}"`);
    const isPreview =
      this.githubConfig.previewReleases && isPreviewRelease(version);

    // In dry-run mode, return mock release data since the API call is blocked
    if (isDryRun()) {
      this.logger.info('[dry-run] Would create draft release');
      return {
        id: 0,
        tag_name: tag,
        upload_url: '',
        draft: true,
      };
    }

    const body = changes?.body
      ? this.truncateBody(changes.body, revision, changes)
      : undefined;

    const { data } = await this.github.repos.createRelease({
      draft: true,
      name: changes?.name || tag,
      owner: this.githubConfig.owner,
      prerelease: isPreview,
      repo: this.githubConfig.repo,
      tag_name: tag,
      target_commitish: revision,
      body,
    });

    return data;
  }

  /**
   * Attempts to create a draft release, recovering from 422 errors caused by
   * leftover draft releases from a previous failed run.
   *
   * GitHub's getReleaseByTag API only returns published releases, so leftover
   * drafts cannot be detected upfront. Instead, we catch the 422 from
   * createRelease, find the conflicting draft via listReleases, delete it,
   * and retry the creation.
   *
   * @param version The version to release
   * @param revision Git commit SHA
   * @param changes Changeset information
   * @returns The newly created draft release
   */
  private async createOrRecoverDraftRelease(
    version: string,
    revision: string,
    changes?: Changeset,
  ): Promise<GitHubRelease> {
    try {
      return await this.createDraftRelease(version, revision, changes);
    } catch (error) {
      if (error.status !== 422) {
        throw error;
      }

      // A 422 likely means a release (probably a leftover draft) already
      // exists for this tag. Try to find and clean it up.
      const tag = versionToTag(version, this.githubConfig.tagPrefix);
      this.logger.info(
        `createRelease returned 422 for tag "${tag}". ` +
          'Looking for a leftover draft release to clean up...',
      );

      const drafts = await this.findDraftReleasesByTag(tag);
      if (drafts.length === 0) {
        // The 422 was for a different reason (not a duplicate tag).
        this.logger.warn(
          `No leftover draft releases found for tag "${tag}". ` +
            'The 422 error may be for a different reason.',
        );
        throw error;
      }

      for (const draft of drafts) {
        this.logger.info(
          `Deleting leftover draft release (id=${draft.id}) for tag "${tag}"...`,
        );
        try {
          await this.deleteRelease(draft);
        } catch (deleteError) {
          this.logger.warn(
            `Failed to delete leftover draft release: ${deleteError}`,
          );
        }
      }

      // Retry creation after cleanup
      return this.createDraftRelease(version, revision, changes);
    }
  }

  /**
   * Finds draft releases matching a specific tag name.
   *
   * The listReleases API includes draft releases (for users with push access),
   * unlike getReleaseByTag which only returns published releases.
   *
   * Only the first page (100 releases) is checked. A leftover draft from a
   * crashed run will be among the most recent releases, so pagination is
   * unnecessary in practice.
   *
   * @param tag The tag name to search for
   * @returns Array of draft releases matching the tag
   */
  public async findDraftReleasesByTag(
    tag: string,
  ): Promise<GitHubRelease[]> {
    const { data: releases } = await this.github.repos.listReleases({
      owner: this.githubConfig.owner,
      repo: this.githubConfig.repo,
      per_page: 100,
    });
    return releases.filter(r => r.tag_name === tag && r.draft === true);
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
   * Can also be used to delete orphaned (unfinished) releases
   *
   * @param asset Asset to delete
   */
  public async deleteAsset(
    asset: ReposListAssetsForReleaseResponseItem,
  ): Promise<boolean> {
    this.logger.debug(`Deleting asset: "${asset.name}"...`);
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
   * Deletes the provided release if it is a draft
   *
   * Used to clean up orphaned draft releases when publish fails.
   * Refuses to delete non-draft releases as a safety measure.
   *
   * @param release Release to delete
   * @returns true if deleted, false if skipped (dry-run or not a draft)
   */
  public async deleteRelease(release: GitHubRelease): Promise<boolean> {
    this.logger.debug(`Deleting release: "${release.tag_name}"...`);

    if (release.draft === false) {
      this.logger.warn(
        `Refusing to delete release "${release.tag_name}" because it is not a draft`,
      );
      return false;
    }

    return (
      (
        await this.github.repos.deleteRelease({
          release_id: release.id,
          ...this.githubConfig,
        })
      ).status === 204
    );
  }

  /**
   * Fetches the current state of a release from GitHub by its ID.
   *
   * Used to verify a release's draft status before attempting cleanup,
   * since the local object may be stale after a failed publishRelease() call.
   *
   * @param releaseId The release ID to fetch
   * @returns The release data, or undefined if the release no longer exists
   */
  public async getRelease(
    releaseId: number,
  ): Promise<GitHubRelease | undefined> {
    try {
      const { data } = await this.github.repos.getRelease({
        owner: this.githubConfig.owner,
        repo: this.githubConfig.repo,
        release_id: releaseId,
      });
      return data;
    } catch (error) {
      if (error.status === 404) {
        return undefined;
      }
      throw error;
    }
  }

  /**
   * Fetches a release by its tag name.
   *
   * Used to detect existing releases on re-run, so Craft can skip creation
   * if a release was already published in a previous (crashed) run.
   *
   * @param tag The tag name to look up
   * @returns The release data, or undefined if no release exists for this tag
   */
  public async getReleaseByTag(
    tag: string,
  ): Promise<GitHubRelease | undefined> {
    try {
      const { data } = await this.github.repos.getReleaseByTag({
        owner: this.githubConfig.owner,
        repo: this.githubConfig.repo,
        tag,
      });
      return data;
    } catch (error) {
      if (error.status === 404) {
        return undefined;
      }
      throw error;
    }
  }

  /**
   * Fetches a list of all assets for the given release
   *
   * The result includes unfinished asset uploads.
   *
   * @param release Release to fetch assets from
   */
  public async getAssetsForRelease(
    release_id: number,
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
   * @param release Release object ID
   * @param assetName Asset name to be deleted
   */
  public async deleteAssetByName(
    release_id: number,
    assetName: string,
  ): Promise<boolean> {
    const assets = await this.getAssetsForRelease(release_id);
    const assetToDelete = assets.find(({ name }) => name === assetName);
    if (!assetToDelete) {
      logger.warn(
        `No such asset with the name "${assetToDelete}", moving on. We have these instead: ${assets.map(
          ({ name }) => name,
        )}`,
      );
      return false;
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
    release: GitHubRelease,
    path: string,
    contentType?: string,
  ): Promise<string | undefined> {
    const name = basename(path);

    return safeExec(async () => {
      process.stderr.write(
        `Uploading asset "${name}" to ${this.githubConfig.owner}/${this.githubConfig.repo}:${release.tag_name}\n`,
      );

      try {
        const { url } = await this.handleGitHubUpload(
          release,
          path,
          contentType,
        );
        process.stderr.write(`✔ Uploaded asset "${name}".\n`);
        return url;
      } catch (e) {
        process.stderr.write(`✖ Cannot upload asset "${name}".\n`);
        throw e;
      }
    }, `github.repos.uploadReleaseAsset(${name})`);
  }

  private async handleGitHubUpload(
    release: GitHubRelease,
    path: string,
    contentType?: string,
    retries = 3,
  ): Promise<{ url: string; size: number }> {
    const contentTypeProcessed = contentType || DEFAULT_CONTENT_TYPE;
    const stats = statSync(path);
    const name = basename(path);
    // this must be recreated each attempt to prevent fd reuse
    const file = createReadStream(path);

    const params = {
      ...this.githubConfig,
      headers: {
        'Content-Length': stats.size,
        'Content-Type': contentTypeProcessed,
      },
      release_id: release.id,
      name,
      // XXX: Octokit types this out as string, but in fact it also
      // accepts a `Buffer` here. In fact passing a string is not what we
      // want as we upload binary data.
      data: file as any,
      request: {
        // we are handling retries -- octokit-retries will resuse our fd and
        // hang forever
        retries: 0,
        timeout: 10 * 1000,
      },
    };

    this.logger.trace('Upload parameters:', params);

    try {
      const ret = (await this.github.repos.uploadReleaseAsset(params)).data;

      if (ret.size != stats.size) {
        throw new Error(
          `Uploaded asset size (${ret.size} bytes) does not match local asset size (${stats.size} bytes) for "${name}".`,
        );
      }

      return ret;
    } catch {
      if (retries <= 0) {
        throw new Error(
          `Reached maximum retries for trying to upload asset "${params.name}.`,
        );
      }

      logger.info(
        'Got an error when trying to upload an asset, deleting and retrying...',
      );
      await this.deleteAssetByName(params.release_id, params.name);
      return this.handleGitHubUpload(release, path, contentType, --retries);
    } finally {
      file.destroy();
    }
  }

  /**
   * Publishes the draft release.
   *
   * @param release Release object
   */
  public async publishRelease(
    release: GitHubRelease,
    options: { makeLatest: boolean } = { makeLatest: true },
  ) {
    await this.github.repos.updateRelease({
      ...this.githubConfig,
      release_id: release.id,
      // This is a string on purpose - see https://docs.github.com/en/rest/releases/releases?apiVersion=2022-11-28#create-a-release
      make_latest: options.makeLatest ? 'true' : 'false',
      draft: false,
    });
  }

  /**
   * Creates a git tag in the remote repository for the version.
   *
   * The function currently creates a lightweight (not annotated) tag.
   * "tagPrefix" is respected when creating a tag name.
   *
   * @param version New version to be released
   * @param revision Git commit SHA to be published
   */
  protected async createGitTag(
    version: string,
    revision: string,
  ): Promise<any> {
    const tag = versionToTag(version, this.githubConfig.tagPrefix);
    const tagRef = `refs/tags/${tag}`;
    this.logger.info(`Pushing the tag reference: "${tagRef}"...`);
    await this.github.rest.git.createRef({
      owner: this.githubConfig.owner,
      repo: this.githubConfig.repo,
      ref: tagRef,
      sha: revision,
    });
  }

  /**
   * Resolves a floating tag pattern by replacing placeholders with version components.
   *
   * @param pattern The pattern string (e.g., "v{major}")
   * @param parsedVersion The parsed semantic version
   * @returns The resolved tag name (e.g., "v2")
   */
  protected resolveFloatingTag(pattern: string, parsedVersion: SemVer): string {
    return pattern
      .replace('{major}', String(parsedVersion.major))
      .replace('{minor}', String(parsedVersion.minor))
      .replace('{patch}', String(parsedVersion.patch));
  }

  /**
   * Creates or updates floating tags for the release.
   *
   * Floating tags (like "v2") point to the latest release in a major version line.
   * They are force-updated if they already exist.
   *
   * @param version The version being released
   * @param revision Git commit SHA to point the tags to
   */
  protected async updateFloatingTags(
    version: string,
    revision: string,
  ): Promise<void> {
    const floatingTags = this.githubConfig.floatingTags;
    if (!floatingTags || floatingTags.length === 0) {
      return;
    }

    const parsedVersion = parseVersion(version);
    if (!parsedVersion) {
      this.logger.warn(
        `Cannot parse version "${version}" for floating tags, skipping`,
      );
      return;
    }

    for (const pattern of floatingTags) {
      const tag = this.resolveFloatingTag(pattern, parsedVersion);
      const tagRef = `refs/tags/${tag}`;

      await safeExec(async () => {
        this.logger.info(`Updating floating tag: "${tag}"...`);

        try {
          // Try to update existing tag
          await this.github.rest.git.updateRef({
            owner: this.githubConfig.owner,
            repo: this.githubConfig.repo,
            ref: `tags/${tag}`,
            sha: revision,
            force: true,
          });
          this.logger.debug(`Updated existing floating tag: "${tag}"`);
        } catch (error) {
          // Tag doesn't exist, create it
          if (error.status === 422) {
            await this.github.rest.git.createRef({
              owner: this.githubConfig.owner,
              repo: this.githubConfig.repo,
              ref: tagRef,
              sha: revision,
            });
            this.logger.debug(`Created new floating tag: "${tag}"`);
          } else {
            throw error;
          }
        }
      }, `github.git.updateRef(tags/${tag})`);
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
    if (this.githubConfig.tagOnly) {
      this.logger.info(
        `Not creating a GitHub release because "tagOnly" flag was set.`,
      );
      await this.createGitTag(version, revision);
      await this.updateFloatingTags(version, revision);
      return;
    }

    const config = getConfiguration();
    let changelog;
    if (config.changelogPolicy !== ChangelogPolicy.None) {
      changelog = await this.getChangelog(version);
    }

    const artifacts = await this.getArtifactsForRevision(revision);
    const localArtifacts = await Promise.all(
      artifacts.map(async artifact => ({
        mimeType: artifact.mimeType,
        path: await this.artifactProvider.downloadArtifact(artifact),
      })),
    );

    let latestRelease: { tag_name: string } | undefined = undefined;
    try {
      latestRelease = (
        await this.github.repos.getLatestRelease({
          owner: this.githubConfig.owner,
          repo: this.githubConfig.repo,
        })
      ).data;
    } catch (error) {
      // if the error is a 404 error, it means that no release exists yet
      // all other errors should be rethrown
      if (error.status !== 404) {
        throw error;
      }
    }

    const latestReleaseTag = latestRelease?.tag_name;
    this.logger.info(
      latestReleaseTag
        ? `Previous release: ${latestReleaseTag}`
        : 'No previous release found',
    );

    // Preview versions should never be marked as latest
    const isPreview =
      this.githubConfig.previewReleases && isPreviewRelease(version);
    const makeLatest = isPreview
      ? false
      : isLatestRelease(latestRelease, version);

    // Check if a published release for this tag already exists. This
    // handles the case where a previous publish run succeeded but crashed
    // before persisting state (e.g., floating tag failure or process crash).
    // Note: getReleaseByTag only returns published releases — draft releases
    // return 404. Draft cleanup is handled separately below via 422 recovery.
    const tag = versionToTag(version, this.githubConfig.tagPrefix);
    const existingRelease = await this.getReleaseByTag(tag);
    if (existingRelease) {
      this.logger.info(
        `Release for tag "${tag}" already exists and is published. ` +
          'Skipping GitHub release creation (likely from a previous run).',
      );
      // Still attempt floating tag updates since they may have failed
      // in the previous run
      try {
        await this.updateFloatingTags(version, revision);
      } catch (floatingTagError) {
        this.logger.warn(`Failed to update floating tags: ${floatingTagError}`);
      }
      return;
    }

    const draftRelease = await this.createOrRecoverDraftRelease(
      version,
      revision,
      changelog,
    );

    try {
      await Promise.all(
        localArtifacts.map(({ path, mimeType }) =>
          this.uploadAsset(draftRelease, path, mimeType),
        ),
      );

      await this.publishRelease(draftRelease, { makeLatest });
    } catch (error) {
      // Before attempting cleanup, re-fetch the release to check its
      // actual state. If publishRelease() half-succeeded (server processed
      // the request but the response timed out), the release may already
      // be published — deleting it would cause data loss.
      try {
        const currentRelease = await this.getRelease(draftRelease.id);
        if (currentRelease && currentRelease.draft === false) {
          // The release was already published — this is the
          // "half-succeeded publishRelease" scenario. The release is
          // live, so we must NOT delete it.
          this.logger.warn(
            `Release "${draftRelease.tag_name}" was already published on GitHub despite the error. ` +
              'Skipping cleanup to avoid deleting a live release.',
          );
        } else if (currentRelease) {
          // Release still exists and is still a draft — safe to clean up.
          // Note: there is an inherent TOCTOU race between the re-fetch
          // and the delete — the release could be published by another
          // actor between these calls. deleteRelease() has its own
          // draft === false guard as a second layer of defense.
          await this.deleteRelease(currentRelease);
          this.logger.info(
            `Deleted orphaned draft release: ${draftRelease.tag_name}`,
          );
        } else {
          // Release was already deleted or never created
          this.logger.debug(
            `Release ${draftRelease.id} no longer exists, nothing to clean up`,
          );
        }
      } catch (cleanupError) {
        this.logger.warn(
          `Failed to clean up release "${draftRelease.tag_name}": ${cleanupError}`,
        );
      }
      throw error;
    }

    // Floating tag updates are best-effort — the release is already published.
    // A failure here must not mark the target as failed, since re-running
    // would attempt to create a duplicate release.
    try {
      await this.updateFloatingTags(version, revision);
    } catch (floatingTagError) {
      this.logger.warn(
        `Failed to update floating tags (release is already published): ${floatingTagError}`,
      );
      this.logger.warn('You may need to update floating tags manually.');
    }
  }
}

export function isLatestRelease(
  githubRelease: { tag_name: string } | undefined,
  version: string,
) {
  const latestVersion = githubRelease && parseVersion(githubRelease.tag_name);
  const versionToPublish = parseVersion(version);
  return latestVersion && versionToPublish
    ? versionGreaterOrEqualThan(versionToPublish, latestVersion)
    : true; // By default, we tag as latest
}
