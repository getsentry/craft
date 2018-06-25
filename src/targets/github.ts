import * as Github from '@octokit/rest';
import { createReadStream, statSync } from 'fs';
import { basename } from 'path';

import { getConfiguration } from '../config';
import { ZeusStore } from '../stores/zeus';
import { findChangeset } from '../utils/changes';
import { getFile } from '../utils/github';
import { BaseTarget } from './base';

/**
 * Path to the changelog file in the target repository
 * TODO: Make this configurable
 */
export const DEFAULT_CHANGELOG_PATH = 'CHANGELOG.md';

/**
 * Default content type for release assets
 */
export const DEFAULT_CONTENT_TYPE = 'application/octet-stream';

export interface GithubTargetOptions {
  owner: string;
  repo: string;
  token: string;
  changelog?: string;
}

export class GithubTarget extends BaseTarget {
  public readonly name: string = 'github';
  public githubConfig: GithubTargetOptions;
  public github: Github;

  public constructor(config: any, store: ZeusStore) {
    super(config, store);
    this.githubConfig = this.getGithubConfig();
    this.github = new Github();
    this.github.authenticate({
      token: this.githubConfig.token,
      type: 'token',
    });
  }

  /** TODO */
  public getGithubConfig(): GithubTargetOptions {
    // We extract global Github configuration (owner/repo) from top-level
    // configuration
    const repoGithubConfig = getConfiguration().github || {};

    if (!repoGithubConfig) {
      throw new Error('GitHub configuration not found in the config file');
    }

    if (!repoGithubConfig.owner) {
      throw new Error('GitHub target: owner not found');
    }

    if (!repoGithubConfig.repo) {
      throw new Error('GitHub target: repo not found');
    }

    const githubApiToken = process.env.GITHUB_API_TOKEN || '';
    if (!githubApiToken) {
      throw new Error(
        'GitHub target: GITHUB_API_TOKEN not found in the environment'
      );
    }
    return {
      changelog: this.config.changelog,
      owner: repoGithubConfig.owner,
      repo: repoGithubConfig.repo,
      token: githubApiToken,
    };
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
    } catch (err) {
      if (err.code !== 404) {
        throw err;
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
    console.log(changelog);

    const changes = (changelog && findChangeset(changelog, tag)) || {};
    console.log(findChangeset(changelog || '', tag));
    console.log(changes);

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
   * Create a new GitHub release and publish all available artifacts.
   *
   * It also creates a tag if it doesn't exist
   *
   * @param version TODO
   * @param revision Git revision to publish (must be a full SHA at the moment!)
   */
  public async publish(version: string, revision: string): Promise<any> {
    console.log(`Target "${this.name}": publishing version ${version}...`);
    console.log(`Revision: ${revision}`);
    const release = (await this.getOrCreateRelease(version, revision)) as any;
    console.log(release);

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

        console.log(
          `Uploading asset "${name}" to ${this.githubConfig.owner}/${
            this.githubConfig.repo
          }:${release.tag_name}`
        );
        return this.github.repos.uploadAsset(params);
      })
    );
  }
}
