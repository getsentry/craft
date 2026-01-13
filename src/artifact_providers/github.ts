import { Octokit, RestEndpointMethodTypes } from '@octokit/rest';
import * as fs from 'fs';
import fetch from 'node-fetch';
import * as path from 'path';
import pLimit from 'p-limit';

import {
  ArtifactProviderConfig,
  BaseArtifactProvider,
  RemoteArtifact,
} from '../artifact_providers/base';
import { getGitHubClient } from '../utils/githubApi';
import {
  detectContentType,
  scan,
  withTempFile,
  withTempDir,
} from '../utils/files';
import { extractZipArchive } from '../utils/system';
import { sleep } from '../utils/async';
import { stringToRegexp } from '../utils/filters';
import { GitHubArtifactsConfig } from '../schemas/project_config';

const MAX_TRIES = 3;
const MILLISECONDS = 1000;
const ARTIFACTS_POLLING_INTERVAL = 10 * MILLISECONDS;
const DOWNLOAD_CONCURRENCY = 3;

export type ArtifactItem =
  RestEndpointMethodTypes['actions']['listArtifactsForRepo']['response']['data']['artifacts'][0];

export type WorkflowRun =
  RestEndpointMethodTypes['actions']['listWorkflowRunsForRepo']['response']['data']['workflow_runs'][0];

/**
 * Normalized artifact filter structure
 */
export interface NormalizedArtifactFilter {
  /** Optional workflow name pattern to match (if undefined, matches all workflows) */
  workflow?: RegExp;
  /** Artifact name patterns to match */
  artifacts: RegExp[];
}

/**
 * Converts a string to a RegExp if it's wrapped in slashes, otherwise creates an exact match RegExp
 */
export function patternToRegexp(pattern: string): RegExp {
  if (pattern.startsWith('/') && pattern.lastIndexOf('/') > 0) {
    return stringToRegexp(pattern);
  }
  // Exact match (escape special regex characters)
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}$`);
}

/**
 * Normalizes artifact patterns from string/array format to array of RegExp
 */
function normalizeArtifactPatterns(
  patterns: string | string[] | undefined
): RegExp[] {
  if (!patterns) {
    return [];
  }
  const patternArray = Array.isArray(patterns) ? patterns : [patterns];
  return patternArray.map(patternToRegexp);
}

/**
 * Normalizes the artifacts config to a standard structure
 *
 * @param config The raw artifacts config from .craft.yml
 * @returns Array of normalized filter objects
 */
export function normalizeArtifactsConfig(
  config: GitHubArtifactsConfig
): NormalizedArtifactFilter[] {
  if (!config) {
    return [];
  }

  if (typeof config === 'string') {
    return [{ workflow: undefined, artifacts: normalizeArtifactPatterns(config) }];
  }

  if (Array.isArray(config)) {
    return [{ workflow: undefined, artifacts: normalizeArtifactPatterns(config) }];
  }

  const filters: NormalizedArtifactFilter[] = [];
  for (const [workflowPattern, artifactPatterns] of Object.entries(config)) {
    filters.push({
      workflow: patternToRegexp(workflowPattern),
      artifacts: normalizeArtifactPatterns(artifactPatterns),
    });
  }
  return filters;
}

/**
 * GitHub artifact provider
 */
export class GitHubArtifactProvider extends BaseArtifactProvider {
  /** GitHub client */
  public readonly github: Octokit;

  public constructor(config: ArtifactProviderConfig) {
    super(config);
    this.github = getGitHubClient();
  }

  /**
   * @inheritDoc
   */
  public async doDownloadArtifact(
    artifact: RemoteArtifact,
    downloadDirectory: string
  ): Promise<string> {
    const destination = path.join(downloadDirectory, artifact.filename);
    this.logger.debug(
      `rename ${artifact.storedFile.downloadFilepath} to ${destination}`
    );
    fs.renameSync(artifact.storedFile.downloadFilepath, destination);
    return destination;
  }

  /**
   * Searched for the artifact with the given revision, paging
   * through results if necessary.
   *
   * @param revision
   * @returns The artifact or null.
   */
  protected async searchForRevisionArtifact(
    revision: string,
    getRevisionDate: lazyRequestCallback<string>
  ): Promise<ArtifactItem | null> {
    const { repoName: repo, repoOwner: owner } = this.config;
    const per_page = 100;

    this.logger.debug(
      `Searching GitHub artifacts for ${owner}/${repo}, revision ${revision}`
    );

    let checkNextPage = true;
    for (let page = 0; checkNextPage; page++) {
      // https://docs.github.com/en/free-pro-team@latest/rest/reference/actions#artifacts
      const artifactResponse = await this.github.actions.listArtifactsForRepo({
        owner: owner,
        repo: repo,
        per_page,
        page,
      });

      const { artifacts, total_count } = artifactResponse.data;
      this.logger.trace(`All available artifacts on page ${page}:`, artifacts);

      // We need to find the most recent archive where name matches the revision.
      // XXX(BYK): we assume the artifacts are listed in descending date order on
      // this endpoint.
      // There is no public documentation on this but the observed data and
      // common-sense logic suggests that this is a reasonably safe assumption.
      const foundArtifact = artifacts.find(
        artifact => artifact.name === revision
      );
      if (foundArtifact) {
        this.logger.trace(`Found artifact on page ${page}:`, foundArtifact);
        return foundArtifact;
      }

      if (total_count <= per_page * (page + 1)) {
        this.logger.debug(`No more pages remaining`);
        break;
      }

      const revisionDate = await getRevisionDate();

      // XXX(BYK): The assumption here is that the artifact created_at date
      // should always be greater than or equal to the associated revision date
      // ** AND **
      // the descending date order. See the note above
      const lastArtifact = artifacts[artifacts.length - 1];
      checkNextPage =
        lastArtifact.created_at == null ||
        lastArtifact.created_at >= revisionDate;
    }

    return null;
  }

  /**
   * Tries to find the artifact with the given revision, retrying if
   * necessary.
   *
   * @param revision
   * @returns The artifact for the given revision or throws an error
   */
  protected async getRevisionArtifact(revision: string): Promise<ArtifactItem> {
    const { repoName: repo, repoOwner: owner } = this.config;
    let artifact;
    const getRevisionDate = lazyRequest<string>(async () => {
      return (
        await this.github.git.getCommit({
          owner,
          repo,
          commit_sha: revision,
        })
      ).data.committer.date;
    });

    for (let tries = 0; tries < MAX_TRIES; tries++) {
      this.logger.info(
        `Fetching GitHub artifacts for ${owner}/${repo}, revision ${revision} (attempt ${
          tries + 1
        } of ${MAX_TRIES})`
      );

      artifact = await this.searchForRevisionArtifact(
        revision,
        getRevisionDate
      );
      if (artifact) {
        return artifact;
      }

      // There may be a race condition between artifacts being uploaded
      // and the GitHub API having the info to return.
      // Wait before retries to give GitHub a chance to propagate changes.
      if (tries + 1 < MAX_TRIES) {
        this.logger.info(
          `Waiting ${
            ARTIFACTS_POLLING_INTERVAL / MILLISECONDS
          } seconds for artifacts to become available via GitHub API...`
        );
        await sleep(ARTIFACTS_POLLING_INTERVAL);
      }
    }

    throw new Error(
      `Can't find any artifacts for revision "${revision}" (tries: ${MAX_TRIES})`
    );
  }

  /**
   * Downloads and unpacks a GitHub artifact in a temp folder
   * @param archiveResponse
   */
  private async downloadAndUnpackArtifacts(
    url: string
  ): Promise<RemoteArtifact[]> {
    const artifacts: RemoteArtifact[] = [];
    await withTempFile(async tempFilepath => {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(
          `Unexpected HTTP response from ${url}: ${response.status} (${response.statusText})`
        );
      }
      await new Promise<void>((resolve, reject) =>
        response.body
          .pipe(fs.createWriteStream(tempFilepath))
          .on('finish', () => resolve())
          .on('error', reject)
      );
      this.logger.info(`Finished downloading.`);

      await withTempDir(async tmpDir => {
        this.logger.debug(`Extracting "${tempFilepath}" to "${tmpDir}"...`);
        await extractZipArchive(tempFilepath, tmpDir);
        (await scan(tmpDir)).forEach(file => {
          artifacts.push({
            filename: path.basename(file),
            mimeType: detectContentType(file),
            storedFile: {
              downloadFilepath: file,
              filename: path.basename(file),
              size: fs.lstatSync(file).size,
            },
          } as RemoteArtifact);
        });
      }, false);
    });

    return artifacts;
  }

  /**
   * Returns {@link ArtifactResponse} for a giving {@link ArtifactItem}
   * @param foundArtifact
   */
  private async getArchiveDownloadUrl(
    foundArtifact: ArtifactItem
  ): Promise<string> {
    const { repoName, repoOwner } = this.config;

    const archiveResponse = await this.github.actions.downloadArtifact({
      owner: repoOwner,
      repo: repoName,
      artifact_id: foundArtifact.id,
      archive_format: 'zip',
    });

    return archiveResponse.url;
  }

  /**
   * Gets workflow runs for a specific commit SHA
   *
   * @param revision Git commit SHA
   * @returns Array of workflow runs for the commit
   */
  protected async getWorkflowRunsForCommit(
    revision: string
  ): Promise<WorkflowRun[]> {
    const { repoName: repo, repoOwner: owner } = this.config;

    this.logger.debug(
      `Fetching workflow runs for commit ${revision} from ${owner}/${repo}`
    );

    const runs: WorkflowRun[] = [];
    const per_page = 100;

    for (let page = 1; ; page++) {
      const response = await this.github.actions.listWorkflowRunsForRepo({
        owner,
        repo,
        head_sha: revision,
        per_page,
        page,
      });

      runs.push(...response.data.workflow_runs);

      if (response.data.workflow_runs.length < per_page) {
        break;
      }
    }

    this.logger.debug(`Found ${runs.length} workflow runs for commit`);
    return runs;
  }

  /**
   * Filters workflow runs by name patterns
   *
   * @param runs Array of workflow runs
   * @param filters Array of normalized filters
   * @returns Filtered workflow runs that match at least one filter's workflow pattern
   */
  protected filterWorkflowRuns(
    runs: WorkflowRun[],
    filters: NormalizedArtifactFilter[]
  ): WorkflowRun[] {
    // If no filters have workflow patterns, return all runs
    const hasWorkflowFilters = filters.some(f => f.workflow !== undefined);
    if (!hasWorkflowFilters) {
      return runs;
    }

    return runs.filter(run => {
      const workflowName = run.name ?? '';
      return filters.some(
        filter => !filter.workflow || filter.workflow.test(workflowName)
      );
    });
  }

  /**
   * Gets artifacts from workflow runs and filters them by patterns
   *
   * @param runs Array of workflow runs
   * @param filters Array of normalized filters
   * @returns Array of matching artifacts
   */
  protected async getArtifactsFromWorkflowRuns(
    runs: WorkflowRun[],
    filters: NormalizedArtifactFilter[]
  ): Promise<ArtifactItem[]> {
    const { repoName: repo, repoOwner: owner } = this.config;
    const matchingArtifacts: ArtifactItem[] = [];

    for (const run of runs) {
      const workflowName = run.name ?? '';
      this.logger.debug(
        `Fetching artifacts for workflow run "${workflowName}" (ID: ${run.id})`
      );

      const per_page = 100;
      for (let page = 1; ; page++) {
        const response = await this.github.actions.listWorkflowRunArtifacts({
          owner,
          repo,
          run_id: run.id,
          per_page,
          page,
        });

        for (const artifact of response.data.artifacts) {
          for (const filter of filters) {
            if (filter.workflow && !filter.workflow.test(workflowName)) {
              continue;
            }

            const matches = filter.artifacts.some(pattern =>
              pattern.test(artifact.name)
            );
            if (matches) {
              this.logger.debug(
                `Artifact "${artifact.name}" matches filter from workflow "${workflowName}"`
              );
              matchingArtifacts.push(artifact);
              break;
            }
          }
        }

        if (response.data.artifacts.length < per_page) {
          break;
        }
      }
    }

    this.logger.debug(`Found ${matchingArtifacts.length} matching artifacts`);
    return matchingArtifacts;
  }

  /**
   * Downloads multiple artifacts in parallel and unpacks them
   *
   * @param artifactItems Array of artifact items to download
   * @returns Array of remote artifacts from all downloaded zip files
   */
  protected async downloadArtifactsInParallel(
    artifactItems: ArtifactItem[]
  ): Promise<RemoteArtifact[]> {
    const limit = pLimit(DOWNLOAD_CONCURRENCY);
    const allArtifacts: RemoteArtifact[] = [];

    const downloadPromises = artifactItems.map(item =>
      limit(async () => {
        this.logger.debug(`Downloading artifact "${item.name}"...`);
        const url = await this.getArchiveDownloadUrl(item);
        const artifacts = await this.downloadAndUnpackArtifacts(url);
        return artifacts;
      })
    );

    const results = await Promise.all(downloadPromises);
    for (const artifacts of results) {
      allArtifacts.push(...artifacts);
    }

    return allArtifacts;
  }

  /**
   * Fetches artifacts using the new workflow-based approach
   *
   * @param revision Git commit SHA
   * @param filters Normalized artifact filters
   * @returns Array of remote artifacts
   */
  protected async doListArtifactsWithFilters(
    revision: string,
    filters: NormalizedArtifactFilter[]
  ): Promise<RemoteArtifact[]> {
    for (let tries = 0; tries < MAX_TRIES; tries++) {
      this.logger.info(
        `Fetching GitHub artifacts for revision ${revision} using artifact filters (attempt ${
          tries + 1
        } of ${MAX_TRIES})`
      );

      const allRuns = await this.getWorkflowRunsForCommit(revision);
      if (allRuns.length === 0) {
        this.logger.debug(`No workflow runs found for commit ${revision}`);
        if (tries + 1 < MAX_TRIES) {
          this.logger.info(
            `Waiting ${
              ARTIFACTS_POLLING_INTERVAL / MILLISECONDS
            } seconds for workflow runs to become available...`
          );
          await sleep(ARTIFACTS_POLLING_INTERVAL);
          continue;
        }
        throw new Error(
          `No workflow runs found for revision "${revision}" (tries: ${MAX_TRIES})`
        );
      }

      const filteredRuns = this.filterWorkflowRuns(allRuns, filters);
      this.logger.debug(
        `${filteredRuns.length} of ${allRuns.length} workflow runs match filters`
      );

      const matchingArtifacts = await this.getArtifactsFromWorkflowRuns(
        filteredRuns,
        filters
      );

      if (matchingArtifacts.length === 0) {
        this.logger.debug(`No matching artifacts found`);
        if (tries + 1 < MAX_TRIES) {
          this.logger.info(
            `Waiting ${
              ARTIFACTS_POLLING_INTERVAL / MILLISECONDS
            } seconds for artifacts to become available...`
          );
          await sleep(ARTIFACTS_POLLING_INTERVAL);
          continue;
        }
        throw new Error(
          `No artifacts matching filters found for revision "${revision}" (tries: ${MAX_TRIES})`
        );
      }

      this.logger.debug(
        `Downloading ${matchingArtifacts.length} artifacts in parallel...`
      );
      return await this.downloadArtifactsInParallel(matchingArtifacts);
    }

    throw new Error(
      `Failed to fetch artifacts for revision "${revision}" (tries: ${MAX_TRIES})`
    );
  }

  /**
   * @inheritDoc
   */
  protected async doListArtifactsForRevision(
    revision: string
  ): Promise<RemoteArtifact[]> {
    const artifactsConfig = this.config.artifacts as
      | GitHubArtifactsConfig
      | undefined;
    const filters = normalizeArtifactsConfig(artifactsConfig);

    if (filters.length > 0) {
      return await this.doListArtifactsWithFilters(revision, filters);
    }

    // Legacy: artifact.name === revision SHA
    const foundArtifact = await this.getRevisionArtifact(revision);

    this.logger.debug(`Requesting archive URL from GitHub...`);

    const archiveUrl = await this.getArchiveDownloadUrl(foundArtifact);

    this.logger.debug(`Downloading ZIP from GitHub artifacts...`);

    return await this.downloadAndUnpackArtifacts(archiveUrl);
  }
}

export function lazyRequest<T>(
  cb: lazyRequestCallback<T>
): lazyRequestCallback<T> {
  let data: T;
  return async () => {
    if (!data) {
      data = await cb();
    }
    return data;
  };
}

export interface lazyRequestCallback<T> {
  (): Promise<T>;
}
