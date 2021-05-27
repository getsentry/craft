import Github from '@octokit/rest';

import { LogLevel, logger } from '../logger';

import { ConfigurationError } from './errors';

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

  public constructor(
    owner: string,
    repo: string,
    username?: string,
    apiToken?: string
  ) {
    this.owner = owner;
    this.repo = repo;
    if (username && apiToken) {
      this.setAuth(username, apiToken);
    }
    this.url = `/${this.owner}/${this.repo}/`;
  }

  /**
   * Sets authentication arguments: username and personal API token
   *
   * @param username GitHub username
   * @param apiToken GitHub API token
   */
  public setAuth(username: string, apiToken: string): void {
    this.username = username;
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
 * @returns Github authentication token if found
 */
export function getGithubApiToken(): string {
  const githubApiToken =
    process.env.GITHUB_TOKEN || process.env.GITHUB_API_TOKEN;
  if (!githubApiToken) {
    throw new ConfigurationError(
      'GitHub target: GITHUB_TOKEN not found in the environment'
    );
  }
  return githubApiToken;
}

/**
 * Gets an authenticated Github client object
 *
 * The authentication token is taken from the environment, if not provided.
 *
 * @param token Github authentication token
 * @returns Github client
 */
export function getGithubClient(token = ''): Github {
  const githubApiToken = token || getGithubApiToken();

  const attrs = {
    auth: `token ${githubApiToken}`,
  } as any;

  if (logger.level >= LogLevel.Debug) {
    attrs.log = {
      info: (message: string, _: any) => {
        logger.debug(message);
      },
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { retry } = require('@octokit/plugin-retry');
  const octokitWithRetries = Github.plugin(retry);
  return new octokitWithRetries(attrs);
}

/**
 * Gets the currently authenticated GitHub user from the client
 *
 * @param github Github client
 * @returns Github username
 */
export async function getAuthUsername(github: Github): Promise<string> {
  const userData = await github.users.getAuthenticated({});
  const username = (userData.data || {}).login;
  if (!username) {
    throw new Error('Cannot reliably detect Github username, aborting');
  }
  return username;
}

/**
 * Loads a file from the context's repository
 *
 * @param github Github client
 * @param owner Repository owner
 * @param repo Repository name
 * @param path The path of the file in the repository
 * @param ref The string name of commit / branch / tag
 * @returns The decoded file contents
 */
export async function getFile(
  github: Github,
  owner: string,
  repo: string,
  path: string,
  ref: string
): Promise<string | undefined> {
  try {
    const response = await github.repos.getContents({
      owner,
      path,
      ref,
      repo,
    });
    // Response theoretically could be a list of files
    if (response.data instanceof Array || response.data.content === undefined) {
      return undefined;
    }
    return Buffer.from(response.data.content, 'base64').toString();
  } catch (e) {
    if (e.status === 404) {
      return undefined;
    }
    throw e;
  }
}
