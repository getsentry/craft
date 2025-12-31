import { Octokit } from '@octokit/rest';

import { LogLevel, logger } from '../logger';

import { ConfigurationError } from './errors';
import { createDryRunOctokit } from './dryRun';

/**
 * Abstraction for GitHub remotes
 */
export class GitHubRemote {
  /** GitHub owner */
  public readonly owner: string;
  /** GitHub repository name */
  public readonly repo: string;
  /** GitHub username */
  protected username?: string;
  /** GitHub personal authentication token */
  protected apiToken?: string;
  /** GitHub hostname */
  protected readonly GITHUB_HOSTNAME: string = 'github.com';
  /** Protocol prefix */
  protected readonly PROTOCOL_PREFIX: string = 'https://';
  /** Url in the form of /OWNER/REPO/ */
  protected readonly url: string;

  public constructor(owner: string, repo: string, apiToken?: string) {
    this.owner = owner;
    this.repo = repo;
    if (apiToken) {
      this.setAuth(apiToken);
    }
    this.url = `/${this.owner}/${this.repo}/`;
  }

  /**
   * Sets authentication arguments: username and personal API token
   *
   * @param username GitHub username
   * @param apiToken GitHub API token
   */
  public setAuth(apiToken: string): void {
    this.username = 'placeholderusername';
    this.apiToken = apiToken;
  }

  /**
   * Returns an HTTP-based git remote
   *
   * It is guaranteed not to contain any sensitive information (e.g. API tokens)
   */
  public getRemoteString(): string {
    return this.PROTOCOL_PREFIX + this.GITHUB_HOSTNAME + this.url;
  }

  /**
   * Returns an HTTP-based git remote with embedded HTTP basic auth
   *
   * It MAY contain sensitive information (e.g. API tokens)
   */
  public getRemoteStringWithAuth(): string {
    const authData =
      this.username && this.apiToken
        ? `${this.username}:${this.apiToken}@`
        : '';
    return this.PROTOCOL_PREFIX + authData + this.GITHUB_HOSTNAME + this.url;
  }
}

/**
 * Gets GitHub API token from environment
 *
 * @returns GitHub authentication token if found
 */
export function getGitHubApiToken(): string {
  const githubApiToken =
    process.env.GITHUB_TOKEN || process.env.GITHUB_API_TOKEN;
  if (!githubApiToken) {
    throw new ConfigurationError(
      'GITHUB_TOKEN not found. This is required to fetch PR information from GitHub.\n' +
        'Tip: Run `gh auth token` if you have GitHub CLI installed.'
    );
  }
  return githubApiToken;
}

const _GitHubClientCache: Record<string, Octokit> = {};

/**
 * Gets an authenticated GitHub client object
 *
 * The authentication token is taken from the environment, if not provided.
 *
 * @param token GitHub authentication token
 * @returns GitHub client
 */
export function getGitHubClient(token = ''): Octokit {
  const githubApiToken = token || getGitHubApiToken();

  if (!_GitHubClientCache[githubApiToken]) {
    const attrs: any = {
      auth: `token ${githubApiToken}`,
    };

    // Silence debug logs, as they do not provide any useful information
    // about the requests, yet they are very noisy and make it difficult
    // to track what's going on.
    if (logger.level >= LogLevel.Debug) {
      attrs.log = {
        info: (message: string) => logger.debug(message),
      };
    }

    const { retry } = require('@octokit/plugin-retry');
    const octokitWithRetries = Octokit.plugin(retry);
    const client = new octokitWithRetries(attrs);
    // Wrap with dry-run-aware proxy
    _GitHubClientCache[githubApiToken] = createDryRunOctokit(client);
  }

  return _GitHubClientCache[githubApiToken];
}

/**
 * Loads a file from the context's repository
 *
 * @param github GitHub client
 * @param owner Repository owner
 * @param repo Repository name
 * @param path The path of the file in the repository
 * @param ref The string name of commit / branch / tag
 * @returns The decoded file contents
 */
export async function getFile(
  github: Octokit,
  owner: string,
  repo: string,
  path: string,
  ref: string
): Promise<string | undefined> {
  try {
    const response = await github.repos.getContent({
      owner,
      path,
      ref,
      repo,
    });
    // Response theoretically could be a list of files
    if (response.data instanceof Array || !('content' in response.data)) {
      return undefined;
    }
    return Buffer.from(response.data.content, 'base64').toString();
  } catch (e: any) {
    if (e.status === 404) {
      return undefined;
    }
    throw e;
  }
}
