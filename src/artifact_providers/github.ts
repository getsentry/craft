import * as Github from '@octokit/rest';
import * as _ from 'lodash';

import {
  ArtifactProviderConfig,
  BaseArtifactProvider,
  RemoteArtifact,
} from '../artifact_providers/base';
import { getGlobalGithubConfig } from '../config';
import { logger as loggerRaw } from '../logger';
import { GithubGlobalConfig } from '../schemas/project_config';
import { getGithubClient } from '../utils/githubApi';

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
export class HithubArtifactProvider extends BaseArtifactProvider {
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
    // TODO: Return list of paths
    await this.github.request(
      '/repos/{owner}/{repo}/actions/artifacts/{artifact_id}/{archive_format}',
      {
        owner: 'octocat',
        repo: 'hello-world',
        artifact_id: 42,
        archive_format: 'archive_format',
      }
    );
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
    const artifactResponse = ((await this.github.request(
      'GET /repos/{owner}/{repo}/actions/artifacts',
      {
        owner: repoOwner,
        repo: repoName,
      }
    )) as unknown) as ArtifactList;

    // see comment above
    if (artifactResponse.total_count === 0) {
      logger.debug(`Revision \`${revision}\` found.`);
    }

    // We need to find the archive where name maches the revision
    const foundArtifacts = _.filter(
      artifactResponse.artifacts,
      artifact => artifact.name === revision
    );

    // TODO: need to return RemoteArtifact here
    return foundArtifacts as RemoteArtifact;
  }
}
