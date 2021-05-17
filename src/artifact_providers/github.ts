import Github from '@octokit/rest';
import * as fs from 'fs';
import request from 'request';
import * as path from 'path';

import {
  ArtifactProviderConfig,
  BaseArtifactProvider,
  RemoteArtifact,
} from '../artifact_providers/base';
import { getGithubClient } from '../utils/githubApi';
import {
  detectContentType,
  scan,
  withTempFile,
  withTempDir,
} from '../utils/files';
import { extractZipArchive } from '../utils/system';

const MAX_TRIES = 3;

interface ArtifactItem {
  id: number;
  name: string;
  size_in_bytes: number;
  url: string;
  archive_download_url: string;
  created_at: string;
  expires_at: string;
}

interface ArtifactList {
  total_count: number;
  artifacts: Array<ArtifactItem>;
}

interface ArchiveResponse extends Github.AnyResponse {
  url: string;
}

/**
 * Github artifact provider
 */
export class GithubArtifactProvider extends BaseArtifactProvider {
  public readonly name = 'github';
  /** Github client */
  public readonly github: Github;

  public constructor(config: ArtifactProviderConfig) {
    super(config);
    this.github = getGithubClient();
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
   * Tries to find the artifact with the given revision, paging through all results.
   *
   * @param revision
   * @param page
   */
  private async listArtifact(
    revision: string,
    revisionDate?: string,
    page = 0,
    tries = 0
  ): Promise<ArtifactItem> {
    const { repoName: repo, repoOwner: owner } = this.config;
    const per_page = 100;

    // https://docs.github.com/en/free-pro-team@latest/rest/reference/actions#artifacts
    const artifactResponse = ((
      await this.github.request('GET /repos/{owner}/{repo}/actions/artifacts', {
        owner: owner,
        repo: repo,
        per_page,
        page,
      })
    ).data as unknown) as ArtifactList;

    const { artifacts } = artifactResponse;
    this.logger.debug(`All available artifacts on page ${page}:`, artifacts);

    // We need to find the most recent archive where name matches the revision.
    const foundArtifact = artifacts.reduce((result, artifact) =>
      artifact.name === revision && result.created_at < artifact.created_at
        ? artifact
        : result
    );

    if (foundArtifact) {
      this.logger.debug(`Found artifact on page ${page}:`, foundArtifact);
      return foundArtifact;
    }

    let checkNextPage = false;
    if (artifactResponse.total_count > per_page * (page + 1)) {
      if (revisionDate === undefined) {
        revisionDate = (
          await this.github.git.getCommit({
            owner,
            repo,
            commit_sha: revision,
          })
        ).data.committer.date;
      }
      // XXX(BYK): The assumption here is that the artifact created_at date
      // should always be greater than or equal to the associated revision date
      // ** AND **
      // the artifacts are listed in descending date order on this endpoint.
      // There is no public documentation on this but the observed data and
      // common-sense logic suggests that this is a reasonably safe assumption.
      const lastArtifact = artifacts[artifacts.length - 1];
      checkNextPage = lastArtifact.created_at >= revisionDate;
    }

    if (checkNextPage) {
      page += 1;
    } else {
      // If we are retrying, reset page index and start over
      page = 0;
      tries += 1;
    }

    if (tries < MAX_TRIES) {
      return this.listArtifact(revision, revisionDate, page, tries);
    }

    if (artifactResponse.total_count === 0) {
      throw new Error(`Failed to discover any artifacts (tries: ${tries})`);
    } else {
      throw new Error(
        `Can't find any artifacts for revision "${revision}" (tries: ${tries})`
      );
    }
  }

  /**
   * Downloads and unpacks a Github artifact in a temp folder
   * @param archiveResponse
   */
  private async downloadAndUnpackArtifacts(
    archiveResponse: ArchiveResponse
  ): Promise<RemoteArtifact[]> {
    const artifacts: RemoteArtifact[] = [];
    await withTempFile(async tempFilepath => {
      const file = fs.createWriteStream(tempFilepath);

      await new Promise<void>((resolve, reject) => {
        // we need any here since our github api client doesn't have support for artifacts requests yet
        request({ uri: archiveResponse.url })
          .pipe(file)
          .on('finish', () => {
            this.logger.info(`Finished downloading.`);
            resolve();
          })
          .on('error', error => {
            reject(error);
          });
      });

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
   * Returns {@link ArchiveResponse} for a giving {@link ArtifactItem}
   * @param foundArtifact
   */
  private async getArchiveDownloadUrl(
    foundArtifact: ArtifactItem
  ): Promise<ArchiveResponse> {
    const { repoName, repoOwner } = this.config;

    const archiveResponse = (await this.github.request(
      '/repos/{owner}/{repo}/actions/artifacts/{artifact_id}/{archive_format}',
      {
        owner: repoOwner,
        repo: repoName,
        artifact_id: foundArtifact.id,
        archive_format: 'zip',
      }
    )) as ArchiveResponse;

    if (archiveResponse.status !== 200) {
      throw new Error(
        `Failed to fetch archive ${JSON.stringify(archiveResponse)}`
      );
    }
    return archiveResponse;
  }

  /**
   * @inheritDoc
   */
  protected async doListArtifactsForRevision(
    revision: string
  ): Promise<RemoteArtifact[]> {
    const { repoName, repoOwner } = this.config;

    this.logger.info(
      `Fetching Github artifacts for ${repoOwner}/${repoName}, revision ${revision}`
    );

    const foundArtifact = await this.listArtifact(revision);

    this.logger.debug(`Requesting archive URL from Github...`);

    const archiveResponse = await this.getArchiveDownloadUrl(foundArtifact);

    this.logger.debug(`Downloading ZIP from Github artifacts...`);

    return await this.downloadAndUnpackArtifacts(archiveResponse);
  }
}
