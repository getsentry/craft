import * as Github from '@octokit/rest';
import { isDryRun } from 'dryrun';

import * as request from 'request';
import { Duplex, Readable } from 'stream';

import logger from '../logger';

/**
 * Abstraction for GitHub remotes
 */
export class GithubRemote {
  /** GitHub owner */
  public owner: string;
  /** GitHub repository name */
  public repo: string;
  /** GitHub username */
  public username?: string;
  /** GitHub personal authentication token */
  public apiToken?: string;
  /** GitHub hostname */
  private readonly GITHUB_HOSTNAME: string = 'github.com';
  /** Protocol prefix */
  private readonly PROTOCOL_PREFIX: string = 'https://';
  /** Url in the form of /OWNER/REPO/ */
  private readonly url: string;

  public constructor(
    owner: string,
    repo: string,
    username?: string,
    apiToken?: string
  ) {
    this.owner = owner;
    this.repo = repo;
    if (username && apiToken) {
      this.username = username;
      this.apiToken = apiToken;
    }
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
    throw new Error(
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
 * @returns Github object
 */
export function getGithubClient(token: string = ''): Github {
  const githubApiToken = token || getGithubApiToken();
  const github = new Github();
  github.authenticate({ token: githubApiToken, type: 'token' });
  return github;
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
    const response = await github.repos.getContent({
      owner,
      path,
      ref,
      repo,
    });
    return Buffer.from(response.data.content, 'base64').toString();
  } catch (e) {
    if (e.code === 404) {
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
      return response.data.sha as string;
    } else if (response.status === 204) {
      logger.warn('Base already contains the head, nothing to merge');
      return undefined;
    } else {
      throw new Error(`Unexpected response: ${JSON.stringify(response)}`);
    }
  } catch (e) {
    if (e.code === 409) {
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
