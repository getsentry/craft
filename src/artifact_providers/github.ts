import { Octokit, RestEndpointMethodTypes } from '@octokit/rest';
import * as fs from 'fs';
import fetch from 'node-fetch';
import * as path from 'path';

import {
  ArtifactProviderConfig,
  BaseArtifactProvider,
  RemoteArtifact,
} from '../artifact_providers/base';
import { getGitHubClient} from '../utils/githubApi';
import {
  detectContentType,
  scan,
  withTempFile,
  withTempDir,
} from '../utils/files';
import { extractZipArchive } from '../utils/system';
import { sleep } from '../utils/async';

const MAX_TRIES = 3;
const MILLISECONDS = 1000;
const ARTIFACTS_POLLING_INTERVAL = 10 * MILLISECONDS;

export type ArtifactItem = RestEndpointMethodTypes['actions']['listArtifactsForRepo']['response']['data']['artifacts'][0];

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
  // deprecated, see https://github.com/getsentry/craft/issues/552
  protected async searchForRevisionArtifact(revision: string, getRevisionDate: lazyRequestCallback<string>): Promise<ArtifactItem|null>  {
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
   * Searches for the artifact with the given revision, paging
   * through results if necessary.
   *
   * @param revision
   * @returns The artifacts or null.
   */
  protected async searchForRevisionArtifacts(revision: string, getRevisionDate: lazyRequestCallback<string>): Promise<ArtifactItem|null>  {
    const { repoName: repo, repoOwner: owner } = this.config;
    const per_page = 100;

    this.logger.debug(
      `Searching GitHub artifacts for ${owner}/${repo}, revision ${revision}`
    );

    let checkNextPage = true;

    const foundArtifacts = [];

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

      foundArtifacts.concat(artifacts.filter(
        artifact => artifact.name.startsWith(`craft-${revision}-`)
      ));

      if (total_count <= per_page * (page + 1)) {
        this.logger.debug(`No more pages remaining`);
        break;
      }

      // does this need to be pluraled too?
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

    if (foundArtifacts) {
      return foundArtifacts;
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
  protected async getRevisionArtifact(
    revision: string
  ): Promise<ArtifactItem|null> {
    const { repoName: repo, repoOwner: owner } = this.config;
    let artifact;
    const getRevisionDate = lazyRequest<string>(async () => {
      return (await this.github.git.getCommit({
        owner,
        repo,
        commit_sha: revision,
      })).data.committer.date;
    })

    for (let tries = 0; tries < MAX_TRIES; tries++) {
      this.logger.info(
        `Fetching GitHub artifacts for ${owner}/${repo}, revision ${revision} (attempt ${tries + 1} of ${MAX_TRIES})`
      );

      artifacts = await this.searchForRevisionArtifacts(revision, getRevisionDate);
      if (artifacts) {
        return artifacts;
      }

      // There may be a race condition between artifacts being uploaded
      // and the GitHub API having the info to return.
      // Wait before retries to give GitHub a chance to propagate changes.
      if (tries + 1 < MAX_TRIES) {
        this.logger.info(`Waiting ${ARTIFACTS_POLLING_INTERVAL / MILLISECONDS} seconds for artifacts to become available via GitHub API...`);
        await sleep(ARTIFACTS_POLLING_INTERVAL);
      }
    }

    return null;
  }

  protected async getRevisionArtifacts(
    revision: string
  ): Promise<ArtifactItem[]> {
    const { repoName: repo, repoOwner: owner } = this.config;
    let artifact;
    const getRevisionDate = lazyRequest<string>(async () => {
      return (await this.github.git.getCommit({
        owner,
        repo,
        commit_sha: revision,
      })).data.committer.date;
    })

    for (let tries = 0; tries < MAX_TRIES; tries++) {
      this.logger.info(
        `Fetching GitHub artifacts for ${owner}/${repo}, revision ${revision} (attempt ${tries + 1} of ${MAX_TRIES})`
      );

      artifact = await this.searchForRevisionArtifact(revision, getRevisionDate);
      if (artifact) {
        return artifact;
      }

      // There may be a race condition between artifacts being uploaded
      // and the GitHub API having the info to return.
      // Wait before retries to give GitHub a chance to propagate changes.
      if (tries + 1 < MAX_TRIES) {
        this.logger.info(`Waiting ${ARTIFACTS_POLLING_INTERVAL / MILLISECONDS} seconds for artifacts to become available via GitHub API...`);
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
      await new Promise((resolve, reject) =>
        response.body
          .pipe(fs.createWriteStream(tempFilepath))
          .on('finish', resolve)
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
   * @inheritDoc
   */
  protected async doListArtifactsForRevision(
    revision: string
  ): Promise<RemoteArtifact[]> {
    const artifacts: RemoteArtifact[] = [];
    const foundArtifacts: RemoteArtifact[] = [];

    // if not foundArtifact then we should attempt to await this.getRevisionArtifacts(revision);
    // then iterate through multiple archive URLS

    const foundArtifact = await this.getRevisionArtifact(revision);

    // is this how you compare null?
    if (foundArtifact) {
      foundArtifacts.append(foundArtifact)
    } else {
      foundArtifacts = await this.getRevisionArtifacts(revision);
    }

    for (foundArtifact in foundArtifacts) {
      this.logger.debug(`Requesting archive URL from GitHub...`);

      const archiveUrl = await this.getArchiveDownloadUrl(foundArtifact);

      this.logger.debug(`Downloading ZIP from GitHub artifacts...`);

      artifacts.append( await this.downloadAndUnpackArtifacts(archiveUrl) );
    }

    return await artifacts
  }
}

export function lazyRequest<T>(cb: lazyRequestCallback<T>): lazyRequestCallback<T> {
  let data: T;
  return async () => {
    if (!data) {
      data = await cb();
    }
    return data;
  }
}

export interface lazyRequestCallback<T> {
  (): Promise<T>;
}
