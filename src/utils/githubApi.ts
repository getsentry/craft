import { Octokit } from '@octokit/rest';

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
    apiToken?: string
  ) {
    this.owner = owner;
    this.repo = repo;
    this.apiToken = apiToken;
    this.url = `/${this.owner}/${this.repo}/`;
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
   * Using dummy username as it does not matter for cloning
   *
   * It MAY contain sensitive information (e.g. API tokens)
   */
  public getRemoteStringWithAuth(): string {
    const authData =
      this.apiToken
        ? `dummyusername:${this.apiToken}@`
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
      'GitHub target: GITHUB_TOKEN not found in the environment'
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

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { retry } = require('@octokit/plugin-retry');
    const octokitWithRetries = Octokit.plugin(retry);
    _GitHubClientCache[githubApiToken] = new octokitWithRetries(attrs);
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
