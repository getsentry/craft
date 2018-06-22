import * as OctokitRest from '@octokit/rest';

import { getConfiguration } from '../config';
import { ZeusStore } from '../stores/zeus';
import { BaseTarget } from './base';

export interface GithubTargetOptions {
  owner: string;
  repo: string;
  token: string;
}

export class GithubTarget extends BaseTarget {
  public readonly name: string = 'github';
  public githubConfig: GithubTargetOptions;
  public octokit: OctokitRest;

  public constructor(config: any, store: ZeusStore) {
    super(config, store);
    this.githubConfig = this.getGithubConfig();
    this.octokit = new OctokitRest();
    this.octokit.authenticate({
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
   * @async
   */
  public async getOrCreateRelease(
    tag: string
  ): Promise<OctokitRest.AnyResponse> {
    try {
      const response = await this.octokit.repos.getReleaseByTag({
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
    const params = {
      body: 'TODO changelog',
      draft: false,
      name: tag,
      owner: this.githubConfig.owner,
      prerelease: false,
      repo: this.githubConfig.repo,
      tag_name: tag,
    };

    const created = await this.octokit.repos.createRelease(params);
    return created.data;
  }

  /**
   * Create a new GitHub release and publish all available artifacts.
   *
   * @param version TODO
   * @param revision TODO
   */
  public async publish(version: string, revision: string): Promise<any> {
    console.log(`Target "${this.name}": publishing version ${version}...`);
    console.log(revision);
    const response = await this.getOrCreateRelease(version);
    console.log(response);
  }
}
