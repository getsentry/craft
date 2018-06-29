import * as Github from '@octokit/rest';
import { createReadStream, statSync } from 'fs';
import { basename } from 'path';

import { getGithubConfig } from '../config';
import logger from '../logger';
import { ZeusStore } from '../stores/zeus';
import { findChangeset } from '../utils/changes';
import { getFile, getGithubClient } from '../utils/github_api';
import { BaseTarget } from './base';

/**
 * Path to the changelog file in the target repository
 */
export const DEFAULT_CHANGELOG_PATH = 'CHANGELOG.md';

/**
 * Default content type for GitHub release assets
 */
export const DEFAULT_CONTENT_TYPE = 'application/octet-stream';

/**
 * Configuration options for the Github target
 */
export interface GithubTargetOptions {
  owner: string;
  repo: string;
  changelog?: string;
}

/**
 * Target responsible for publishing releases on Github
 */
export class GithubTarget extends BaseTarget {
  /** Target name */
  public readonly name: string = 'github';
  /** High-level non-target Github configuration */
  public readonly githubConfig: GithubTargetOptions;
  /** Github client */
  public readonly github: Github;

  public constructor(config: any, store: ZeusStore) {
    super(config, store);
    this.githubConfig = getGithubConfig();
    this.githubConfig.changelog = this.config.changelog;
    this.github = getGithubClient();
  }

  /**
   * Gets an existing or creates a new release for the given tag
   *
   * The release name and description body is loaded from CHANGELOG.md in the
   * respective tag, if present. Otherwise, the release name defaults to the
   * tag and the body to the commit it points to.
   *
   * @param context Github context
   * @param tag Tag name for this release
   * @returns The newly created release
   */
  public async getOrCreateRelease(
    tag: string,
    revision: string
  ): Promise<Github.AnyResponse> {
    try {
      const response = await this.github.repos.getReleaseByTag({
        owner: this.githubConfig.owner,
        repo: this.githubConfig.repo,
        tag,
      });
      return response.data;
    } catch (e) {
      if (e.code !== 404) {
        throw e;
      }
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

    const params = {
      draft: false,
      name: tag,
      owner: this.githubConfig.owner,
      prerelease: false,
      repo: this.githubConfig.repo,
      tag_name: tag,
      target_commitish: revision,
      ...changes,
    };

    const created = await this.github.repos.createRelease(params);
    return created.data;
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
    logger.info(`Target "${this.name}": publishing version ${version}...`);
    logger.debug(`Revision: ${revision}`);
    const release = (await this.getOrCreateRelease(version, revision)) as any;

    const artifacts = await this.store.listArtifactsForRevision(revision);
    await Promise.all(
      artifacts.map(async artifact => {
        const path = await this.store.downloadArtifact(artifact);
        const stats = statSync(path);
        const name = basename(path);

        const params = {
          contentLength: stats.size,
          contentType: artifact.type || DEFAULT_CONTENT_TYPE,
          file: createReadStream(path),
          id: release.id,
          name,
          url: release.upload_url,
        };

        logger.debug(
          `Uploading asset "${name}" to ${this.githubConfig.owner}/${
            this.githubConfig.repo
          }:${release.tag_name}`
        );
        return this.github.repos.uploadAsset(params);
      })
    );
  }
}
