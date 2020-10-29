import * as Github from '@octokit/rest';
import * as _ from 'lodash';
import * as fs from 'fs';
import * as request from 'request';
import * as path from 'path';

import {
  ArtifactProviderConfig,
  BaseArtifactProvider,
  RemoteArtifact,
} from '../artifact_providers/base';
import { getGlobalGithubConfig } from '../config';
import { logger as loggerRaw } from '../logger';
import { GithubGlobalConfig } from '../schemas/project_config';
import { getGithubClient } from '../utils/githubApi';
import {
  detectContentType,
  scan,
  withTempFile,
  withTempDir,
} from '../utils/files';
import { extractZipArchive } from '../utils/system';

const logger = loggerRaw.withScope(`[artifact-provider/github]`);

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
  /** Github client */
  public readonly github: Github;

  /** Github repo configuration */
  public readonly githubRepo: GithubGlobalConfig;

  public constructor(config: ArtifactProviderConfig) {
    super(config);
    this.github = getGithubClient();
    this.githubRepo = getGlobalGithubConfig();
  }

  /**
   * @inheritDoc
   */
  public async doDownloadArtifact(
    artifact: RemoteArtifact,
    downloadDirectory: string
  ): Promise<string> {
    const destination = path.join(downloadDirectory, artifact.filename);
    logger.debug(
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
    page = 0
  ): Promise<ArtifactItem> {
    const { repoName, repoOwner } = this.config;
    const per_page = 100;

    // https://docs.github.com/en/free-pro-team@latest/rest/reference/actions#artifacts
    const artifactResponse = ((
      await this.github.request('GET /repos/{owner}/{repo}/actions/artifacts', {
        owner: repoOwner,
        repo: repoName,
        per_page,
        page,
      })
    ).data as unknown) as ArtifactList;

    if (artifactResponse.total_count === 0) {
      throw new Error(`Failed to discover any artifacts`);
    }

    // We need to find the archive where name maches the revision
    const foundArtifacts = _.filter(
      artifactResponse.artifacts,
      artifact => artifact.name === revision
    );

    if (foundArtifacts.length === 0) {
      if (artifactResponse.total_count > per_page * (page + 1)) {
        return this.listArtifact(revision, page + 1);
      }
      throw new Error(`Can't find artifacts for revision \`${revision}\``);
    }

    if (foundArtifacts.length > 1) {
      throw new Error(
        `Found multiple artifacts with the same revision \`${revision}\`\n` +
          `Please make sure you job only uploads on set of artifacts.`
      );
    }

    return foundArtifacts[0];
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

      await new Promise((resolve, reject) => {
        // we need any here since our github api client doesn't have support for artifacts requests yet
        request({ uri: archiveResponse.url })
          .pipe(file)
          .on('finish', () => {
            logger.info(`Finished downloading.`);
            resolve();
          })
          .on('error', error => {
            reject(error);
          });
      });

      await withTempDir(async tmpDir => {
        logger.info(`Extracting "${tempFilepath}" to "${tmpDir}"...`);
        await extractZipArchive(tempFilepath, tmpDir);
        await (await scan(tmpDir)).map(file => {
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

    logger.info(
      `Fetching Github artifacts for ${repoOwner}/${repoName}, revision ${revision}`
    );

    const foundArtifact = await this.listArtifact(revision);

    logger.info(`Requesting archive URL from Github...`);

    const archiveResponse = await this.getArchiveDownloadUrl(foundArtifact);

    logger.info(`Downloading ZIP from Github artifacts...`);

    return await this.downloadAndUnpackArtifacts(archiveResponse);
  }
}