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
    fs.renameSync(artifact.storedFile.downloadFilepath, destination);
    return destination;
  }

  /**
   * @inheritDoc
   */
  protected async doListArtifactsForRevision(
    revision: string
  ): Promise<RemoteArtifact[]> {
    const { repoName, repoOwner } = this.config;
    logger.debug(
      `Fetching Github artifacts for ${repoOwner}/${repoName}, revision ${revision}`
    );
    const artifactResponse = ((
      await this.github.request('GET /repos/{owner}/{repo}/actions/artifacts', {
        owner: repoOwner,
        repo: repoName,
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

    if (foundArtifacts.length !== 1) {
      throw new Error(`Can't find artifacts for revision \`${revision}\``);
    }

    logger.info(`Requesting archive URL from Github...`);

    const result = await this.github.request(
      '/repos/{owner}/{repo}/actions/artifacts/{artifact_id}/{archive_format}',
      {
        owner: repoOwner,
        repo: repoName,
        artifact_id: foundArtifacts[0].id,
        archive_format: 'zip',
      }
    );

    if (result.status !== 200) {
      throw new Error(`Failed to fetch archive ${JSON.stringify(result)}`);
    }

    const artifacts: RemoteArtifact[] = [];
    logger.info(`Downloading ZIP from Github artifacts...`);

    await withTempFile(async tempFilepath => {
      const file = fs.createWriteStream(tempFilepath);

      await new Promise((resolve, reject) => {
        // we need any here since our github api client doesn't have support for artifacts requests yet
        request({ uri: (result as any).url })
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
      });
    });

    return artifacts;
  }
}
