import { Octokit } from '@octokit/rest';
import {
  getGitHubApiToken,
  getGitHubClient,
  GitHubRemote,
} from '../utils/githubApi';

import { GitHubTarget } from './github';
import { GitHubGlobalConfig, TargetConfig } from '../schemas/project_config';
import { BaseTarget } from './base';
import {
  BaseArtifactProvider,
  RemoteArtifact,
} from '../artifact_providers/base';
import { reportError } from '../utils/errors';
import { extractZipArchive } from '../utils/system';
import { withTempDir } from '../utils/files';
import { cloneRepo, createGitClient } from '../utils/git';
import { isPreviewRelease } from '../utils/version';
import { NoneArtifactProvider } from '../artifact_providers/none';

/** Name of the artifact that contains the UPM package */
export const ARTIFACT_NAME = 'package-release.zip';

/**
 * Target responsible for publishing to upm registry
 */
export class UpmTarget extends BaseTarget {
  /** Target name */
  public readonly name: string = 'upm';
  /** GitHub client */
  public readonly github: Octokit;
  /** Internal GitHub Target */
  private readonly githubTarget: GitHubTarget;

  public constructor(
    config: TargetConfig,
    artifactProvider: BaseArtifactProvider,
    githubRepo: GitHubGlobalConfig
  ) {
    super(config, artifactProvider, githubRepo);

    this.github = getGitHubClient();

    const githubTargetConfig = {
      name: 'github',
      tagPrefix: config.tagPrefix,
      owner: config.releaseRepoOwner,
      repo: config.releaseRepoName,
    };

    this.githubTarget = new GitHubTarget(
      githubTargetConfig,
      new NoneArtifactProvider(),
      githubRepo
    );
  }

  /**
   * Fetches the artifact for the provided revision.
   *
   * @param revision Git commit SHA for the artifact to be published.
   * @returns The requested artifact. When no artifacts found or multiple
   *          artifacts have been found, returns undefined in dry-run mode and
   *          throws an exception in "normal" mode.
   */
  public async fetchArtifact(
    revision: string
  ): Promise<RemoteArtifact | undefined> {
    const packageFiles = await this.getArtifactsForRevision(revision);
    if (packageFiles.length === 0) {
      reportError('Cannot publish UPM: No release artifact found.');
      return;
    }

    const packageFile = packageFiles.find(
      ({ filename }) => filename === ARTIFACT_NAME
    );
    if (packageFile === undefined) {
      reportError(
        `Cannot publish UPM: Failed to find "${ARTIFACT_NAME}" in the artifacts.`
      );
    }

    return packageFile;
  }

  /**
   * Performs a release to upm
   *
   * @param version New version to be released
   * @param revision Git commit SHA to be published
   */
  public async publish(version: string, revision: string): Promise<any> {
    this.logger.info('Fetching artifact...');
    const packageFile = await this.fetchArtifact(revision);
    if (!packageFile) {
      return;
    }

    this.logger.info(
      `Found artifact: "${packageFile.filename}", downloading...`
    );
    const artifactPath = await this.artifactProvider.downloadArtifact(
      packageFile
    );

    const remote = new GitHubRemote(
      this.config.releaseRepoOwner,
      this.config.releaseRepoName,
      getGitHubApiToken()
    );
    const remoteAddr = remote.getRemoteString();
    this.logger.debug(`Target release repository: ${remoteAddr}`);

    await withTempDir(
      async directory => {
        const git = await cloneRepo(remote.getRemoteStringWithAuth(), directory);

        this.logger.info('Clearing the repository.');
        await git.rm(['-r', '-f', '.']);

        this.logger.info(`Extracting "${packageFile.filename}".`);
        await extractZipArchive(artifactPath, directory);

        this.logger.info('Adding files to repository.');
        await git.add(['.']);
        const commitResult = await git.commit(`release ${version}`);
        if (!commitResult.commit) {
          throw new Error(
            'Commit on target repository failed. Maybe there were no changes at all?'
          );
        }
        const targetRevision = await git.revparse([commitResult.commit]);

        await git.push(['origin', 'main']);
        const changes = await this.githubTarget.getChangelog(version);
        const isPrerelease = isPreviewRelease(version);
        const draftRelease = await this.githubTarget.createDraftRelease(
          version,
          targetRevision,
          changes
        );
        try {
          await this.githubTarget.publishRelease(draftRelease, {
            makeLatest: !isPrerelease,
          });
        } catch (error) {
          // Clean up the orphaned draft release
          try {
            await this.githubTarget.deleteRelease(draftRelease);
            this.logger.info(
              `Deleted orphaned draft release: ${draftRelease.tag_name}`
            );
          } catch (deleteError) {
            this.logger.warn(
              `Failed to delete orphaned draft release: ${deleteError}`
            );
          }
          throw error;
        }
      },
      true,
      '_craft-release-upm-'
    );

    this.logger.info('UPM release complete');
  }
}
