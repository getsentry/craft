import * as Github from '@octokit/rest';
import { isDryRun } from 'dryrun';
import * as request from 'request';
import { Duplex, Readable } from 'stream';

import { LOG_LEVELS, logger } from '../logger';

import { ConfigurationError } from './errors';
import { sleepAsync } from './system';

export const HTTP_UNPROCESSABLE_ENTITY = 422;
export const HTTP_RESPONSE_1XX = /^1\d\d$/;
export const HTTP_RESPONSE_2XX = /^2\d\d$/;
export const HTTP_RESPONSE_3XX = /^3\d\d$/;
export const HTTP_RESPONSE_4XX = /^4\d\d$/;
export const HTTP_RESPONSE_5XX = /^5\d\d$/;

export type RetryCodePattern = number | RegExp;

/**
 * Parameters for retryHttp function
 */
export interface RetryParams {
  /** Number of retries (0 means no retries) */
  retries: number;
  /** Codes to retry */
  retryCodes: RetryCodePattern[];
  /** Timeout interval (ms) before every retry */
  cooldown: number;
  /** Is exponential backoff enabled? (NOT IMPLEMENTED) */
  exponential: boolean;
  /** Function to call before every retry */
  cleanupFn?(): Promise<void>;
}

const defaultRetryParams: RetryParams = {
  cooldown: 1000,
  exponential: false,
  retries: 3,
  retryCodes: [HTTP_RESPONSE_5XX],
};

/**
 * Abstraction for GitHub remotes
 */
export class GithubRemote {
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
  const githubApiToken = process.env.GITHUB_API_TOKEN;
  if (!githubApiToken) {
    throw new ConfigurationError(
      'GitHub target: GITHUB_API_TOKEN not found in the environment'
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
export function getGithubClient(token: string = ''): Github {
  const githubApiToken = token || getGithubApiToken();

  const attrs = {
    auth: `token ${githubApiToken}`,
  } as any;

  if (logger.level >= LOG_LEVELS.DEBUG) {
    attrs.log = {
      info: (message: string, _: any) => {
        logger.debug(message);
      },
    };
  }

  const octokitWithRetries = Github.plugin(require('@octokit/plugin-retry'));
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

/**
 * Gets the default branch for the repository
 *
 * @param github Github client
 * @param owner Repository owner
 * @param repo Repository name
 * @returns Default branch
 */
export async function getDefaultBranch(
  github: Github,
  owner: string,
  repo: string
): Promise<string> {
  const repoInfo = await github.repos.get({ owner, repo });
  return repoInfo.data.default_branch;
}

/**
 * Merges the given release branch into the base branch.
 *
 * @param github Github client
 * @param owner Repository owner
 * @param repo Repository name
 * @param branch Branch to be merged
 * @param base Base branch; set to default repository branch, if not provided
 * @returns SHA of merge commit, or 'undefined' if there was nothing to merge
 */
export async function mergeReleaseBranch(
  github: Github,
  owner: string,
  repo: string,
  branch: string,
  base?: string
): Promise<string | undefined> {
  const baseBranch = base || (await getDefaultBranch(github, owner, repo));
  if (!baseBranch) {
    throw new Error('Cannot determine base branch while merging');
  }

  try {
    logger.info(`Merging release branch: "${branch}" into "${baseBranch}"...`);

    if (isDryRun()) {
      logger.info('[dry-run] Skipping merge.');
      return undefined;
    }

    const response = await github.repos.merge({
      base: baseBranch,
      head: branch,
      owner,
      repo,
    });
    if (response.status === 201) {
      logger.info(`Merging: done.`);
      return response.data.sha;
    } else if (response.status === 204) {
      logger.warn('Base already contains the head, nothing to merge');
      return undefined;
    } else {
      throw new Error(`Unexpected response: ${JSON.stringify(response)}`);
    }
  } catch (e) {
    if (e.status === 409) {
      // Conflicts found
      logger.error(
        `Cannot merge release branch "${branch}": conflicts detected`,
        'Please resolve the conflicts and merge the branch manually:',
        `    git checkout master && git merge ${branch}`
      );
    }
    throw e;
  }
}

/**
 * Downloads the entire repository contents of the tag
 *
 * The contents are compressed into a tarball and returned in a buffer that can
 * be streamed for extraction.
 *
 * @param owner Repository owner
 * @param repo Repository name
 * @param sha Revision SHA identifier
 * @returns The tarball data as stream
 */
export async function downloadSources(
  owner: string,
  repo: string,
  sha: string
): Promise<Readable> {
  logger.info(`Downloading sources for ${owner}/${repo}:${sha}`);
  // TODO add api token to allow downloading from private repos
  const url = `https://github.com/${owner}/${repo}/archive/${sha}.tar.gz`;

  return new Promise<Readable>((resolve, reject) => {
    // tslint:disable-next-line:no-null-keyword
    request({ url, encoding: null }, (error, _response, body: Buffer) => {
      if (error) {
        reject(error);
      }
      const stream = new Duplex();
      stream.push(body);
      stream.push(null); // tslint:disable-line:no-null-keyword
      resolve(stream);
    });
  });
}

/**
 * Checks that the HTTP status code matches one of the patterns
 *
 * A pattern can be either a number or a regular expression.
 *
 * @param code HTTP code to check
 * @param patterns A list of patterns to test
 */
export function codeMatches(
  code: number,
  patterns: RetryCodePattern | RetryCodePattern[]
): boolean {
  const patternList: RetryCodePattern[] = Array.isArray(patterns)
    ? patterns
    : [patterns];

  const stringCode = code.toString();
  if (stringCode.length !== 3) {
    return false;
  }

  for (const pattern of patternList) {
    if (typeof pattern === 'number') {
      if (pattern === code) {
        return true;
      }
    } else {
      // pattern is RegEx
      if (pattern.test(stringCode)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Runs the provided function in the retry loop
 *
 * Used for retrying API requests to GitHub
 *
 * @param fn Function to retry
 * @param retryParams Retry parameters
 */
export async function retryHttp<T>(
  fn: () => Promise<T>,
  retryParams: Partial<RetryParams> = {}
): Promise<T> {
  const params = { ...defaultRetryParams, ...retryParams };
  const maxRetries = params.retries;
  let retryNum = 0;

  while (true) {
    logger.debug(`Retry number ${retryNum}, max retries: ${maxRetries}`);

    try {
      const result = await fn();
      return result;
    } catch (e) {
      const status = e.status as number;
      if (params.retryCodes.indexOf(status) > -1 && retryNum < maxRetries) {
        if (params.cleanupFn) {
          await params.cleanupFn();
        }
        await sleepAsync(params.cooldown);
        retryNum += 1;
        continue;
      } else {
        if (maxRetries > 0 && retryNum >= maxRetries) {
          logger.error(`Maximum retries reached (${maxRetries})`);
        }
        logger.error(`Error code: ${status}`);
        throw e;
      }
    }
  }
}
