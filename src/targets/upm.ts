import * as Github from '@octokit/rest';
import simpleGit from 'simple-git';
import {
  getAuthUsername,
  getGithubApiToken,
  getGithubClient,
  GithubRemote,
} from '../utils/githubApi';

import { GithubTarget } from './github';
import { logger as loggerRaw } from '../logger';
import { GithubGlobalConfig, TargetConfig } from '../schemas/project_config';
import { BaseTarget } from './base';
import {
  BaseArtifactProvider,
  RemoteArtifact,
} from '../artifact_providers/base';
import { reportError } from '../utils/errors';
import { extractZipArchive } from '../utils/system';
import { withTempDir } from '../utils/files';
import { isDryRun } from '../utils/helpers';
import { NoneArtifactProvider } from '../artifact_providers/none';

const logger = loggerRaw.withScope('[upm]');

/**
 * Target responsible for publishing to upm registry
 */
export class UpmTarget extends BaseTarget {
  /** Target name */
  public readonly name: string = 'upm';
  /** Github client */
  public readonly github: Github;
  /** Internal GitHub Target */
  private readonly githubTarget: GithubTarget;

  public constructor(
    config: TargetConfig,
    artifactProvider: BaseArtifactProvider,
    githubRepo: GithubGlobalConfig
  ) {
    super(config, artifactProvider, githubRepo);

    this.github = getGithubClient();

    const githubTargetConfig = {
      name: 'github',
      tagPrefix: config.tagPrefix,
      previewReleases: false,
      annotatedTag: true,
      owner: config.releaseOwner,
      repo: config.releaseRepo,
    };

    this.githubTarget = new GithubTarget(
      githubTargetConfig,
      new NoneArtifactProvider(),
      githubRepo
    );
  }

  /**
   * Fetches the artifact for the provided revision.
   *
   * @param revision Git commit SHA for the to be published artifact.
   * @returns The requested artifact, undefined of no or multiple artifacts
   * have been found.
   */
  protected async fetchArtifact(
    revision: string
  ): Promise<RemoteArtifact | undefined> {
    const packageFiles = await this.getArtifactsForRevision(revision);
    if (packageFiles.length === 0) {
      reportError('Cannot publish UPM: No release artifact found.');
      return;
    }
    if (packageFiles.length > 1) {
      reportError(
        `Cannot publish UPM: Too many release artifacts found:${packageFiles.join(
          '\n'
        )}`
      );
      return;
    }

    return packageFiles[0];
  }

  /**
   * Performs a release to upm
   *
   * @param version New version to be released
   * @param revision Git commit SHA to be published
   */
  public async publish(version: string, revision: string): Promise<any> {
    logger.info('Fetching artifact...');
    const packageFile = await this.fetchArtifact(revision);
    if (!packageFile) {
      return;
    }

    logger.info(`Found artifact: "${packageFile.filename}", downloading...`);
    const artifactPath = await this.artifactProvider.downloadArtifact(
      packageFile
    );

    const username = await getAuthUsername(this.github);
    const remote = new GithubRemote(
      this.config.releaseOwner,
      this.config.releaseRepo,
      username,
      getGithubApiToken()
    );
    const remoteAddr = remote.getRemoteString();
    logger.debug(`Target release repository: ` + `"${remoteAddr}"`);

    await withTempDir(
      async directory => {
        const git = simpleGit(directory);
        logger.info(`Cloning ${remoteAddr} to ${directory}...`);
        await git.clone(remote.getRemoteStringWithAuth(), directory);

        logger.info('Clearing the repository.');
        await git.rm(['-r', '-f', '.']);

        logger.info(`Extracting "${packageFile.filename}".`);
        await extractZipArchive(artifactPath, directory);

        logger.info('Adding files to repository.');
        await git.add(['.']);
        const targetRevision = (await git.commit(`release ${version}`)).commit;

        if (isDryRun()) {
          logger.info('[dry-run]: git push origin main');
        } else {
          await git.push(['origin', 'main']);
          const changes = await this.githubTarget.getRevisionChanges(
            version,
            revision
          );
          await this.githubTarget.getOrCreateRelease(
            version,
            targetRevision,
            changes
          );
        }
      },
      true,
      '_craft-release-upm-'
    );

    logger.info('UPM release complete');
  }
}
