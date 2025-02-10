import * as fs from 'fs';
import * as path from 'path';

import { Octokit } from '@octokit/rest';
import simpleGit from 'simple-git';

import { GitHubGlobalConfig, TargetConfig } from '../schemas/project_config';
import { ConfigurationError, reportError } from '../utils/errors';
import { withTempDir } from '../utils/files';
import {
  getGitHubApiToken,
  getGitHubClient,
  GitHubRemote,
  getGitHubAuthHeader,
} from '../utils/githubApi';
import { isDryRun } from '../utils/helpers';
import { extractZipArchive } from '../utils/system';
import { BaseTarget } from './base';
import { BaseArtifactProvider } from '../artifact_providers/base';

/**
 * Regex for docs archives
 */
const DEFAULT_DEPLOY_ARCHIVE_REGEX = /^(?:.+-)?gh-pages\.zip$/;

const DEFAULT_DEPLOY_BRANCH = 'gh-pages';

/** Target options for "gh-pages" */
export interface GhPagesConfig {
  /** GitHub project owner */
  githubOwner: string;
  /** GitHub project name */
  githubRepo: string;
  /** Git branch to push assets to */
  branch: string;
}

/**
 * Target responsible for publishing static assets to GitHub pages
 */
export class GhPagesTarget extends BaseTarget {
  /** Target name */
  public readonly name: string = 'gh-pages';
  /** Target options */
  public readonly ghPagesConfig: GhPagesConfig;
  /** GitHub client */
  public readonly github: Octokit;
  /** GitHub repo configuration */
  public readonly githubRepo: GitHubGlobalConfig;

  public constructor(
    config: TargetConfig,
    artifactProvider: BaseArtifactProvider,
    githubRepo: GitHubGlobalConfig
  ) {
    super(config, artifactProvider, githubRepo);
    this.github = getGitHubClient();
    this.githubRepo = githubRepo;
    this.ghPagesConfig = this.getGhPagesConfig();
  }

  /**
   * Extracts "gh-pages" target options from the raw configuration
   */
  public getGhPagesConfig(): GhPagesConfig {
    let githubOwner;
    let githubRepo;
    if (this.config.githubOwner && this.config.githubRepo) {
      githubOwner = this.config.githubOwner;
      githubRepo = this.config.githubRepo;
    } else if (!this.config.githubOwner && !this.config.githubRepo) {
      githubOwner = this.githubRepo.owner;
      githubRepo = this.githubRepo.repo;
    } else {
      throw new ConfigurationError(
        '[gh-pages] Invalid repository configuration: check repo owner and name'
      );
    }

    const branch = this.config.branch || DEFAULT_DEPLOY_BRANCH;

    return {
      branch,
      githubOwner,
      githubRepo,
    };
  }

  /**
   * Extracts ZIP archive to the provided directory with some additional checks
   *
   * The method checks that the target directory is an empty directory, or an
   * empty (without any files) git repository. If the extracted archive contains
   * a single top-most parent directory, all the data from it is copied to the
   * parent directory.
   *
   * @param archivePath Path to the ZIP archive
   * @param directory Path to the directory
   */
  public async extractAssets(
    archivePath: string,
    directory: string
  ): Promise<void> {
    // Check that the directory is empty
    const dirContents = fs.readdirSync(directory).filter(f => f !== '.git');
    if (dirContents.length > 0) {
      throw new Error(
        'Destination directory is not empty: cannot extract the acrhive!'
      );
    }

    // Extract the archive
    this.logger.info(`Extracting "${archivePath}" to "${directory}"...`);
    await extractZipArchive(archivePath, directory);

    // If there's a single top-level directory -- move its contents to the git root
    const newDirContents = fs.readdirSync(directory).filter(f => f !== '.git');
    if (
      newDirContents.length === 1 &&
      fs.statSync(path.join(directory, newDirContents[0])).isDirectory()
    ) {
      this.logger.debug(
        'Single top-level directory found, moving files from it...'
      );
      const innerDirPath = path.join(directory, newDirContents[0]);
      fs.readdirSync(innerDirPath).forEach(item => {
        const srcPath = path.join(innerDirPath, item);
        const destPath = path.join(directory, item);
        fs.renameSync(srcPath, destPath);
      });
      fs.rmdirSync(innerDirPath);
    }
  }

  /**
   * Extracts the contents of the given archive, and then commits them
   *
   * @param directory Path to the git repo
   * @param remote Object representing GitHub remote
   * @param branch Branch to push
   * @param archivePath Path to the archive
   * @param version Version to deploy
   */
  public async commitArchiveToBranch(
    directory: string,
    remote: GitHubRemote,
    branch: string,
    archivePath: string,
    version: string
  ): Promise<void> {
    const git = simpleGit(directory);
    /** Add the GitHub token to the git auth header */
    await git.raw(getGitHubAuthHeader());
    this.logger.info(
      `Cloning "${remote.getRemoteString()}" to "${directory}"...`
    );
    await git.clone(remote.getRemoteString(), directory);
    this.logger.debug(`Checking out branch: "${branch}"`);
    try {
      await git.checkout([branch]);
    } catch (e) {
      if (!e.message.match(/pathspec .* did not match any file/)) {
        throw e;
      }
      this.logger.debug(
        `Branch ${branch} does not exist, creating a new orphaned branch...`
      );
      await git.checkout(['--orphan', branch]);
    }

    // Additional check, just in case
    const repoStatus = await git.status();
    if (repoStatus.current !== 'No' && repoStatus.current !== branch) {
      throw new Error(
        `Something went very wrong: cannot switch to branch "${branch}"`
      );
    }

    // Clean the previous state
    this.logger.debug(`Removing existing files from the working tree...`);
    await git.rm(['-r', '-f', '.']);

    // Extract the archive
    await this.extractAssets(archivePath, directory);

    // Commit
    await git.add(['.']);
    await git.commit(`craft(gh-pages): update, version "${version}"`);

    // Push!
    this.logger.info(`Pushing branch "${branch}"...`);
    if (!isDryRun()) {
      await git.push('origin', branch, ['--set-upstream']);
    } else {
      this.logger.info('[dry-run] Not pushing the branch.');
    }
  }

  /**
   * Pushes an archive with static HTML web assets to the configured branch
   */
  public async publish(version: string, revision: string): Promise<any> {
    const { githubOwner, githubRepo, branch } = this.ghPagesConfig;

    this.logger.debug('Fetching artifact list...');
    const packageFiles = await this.getArtifactsForRevision(revision, {
      includeNames: DEFAULT_DEPLOY_ARCHIVE_REGEX,
    });
    if (!packageFiles.length) {
      reportError('Cannot release to GH-pages: no artifacts found');
      return undefined;
    } else if (packageFiles.length > 1) {
      reportError(
        `Not implemented: more than one gh-pages archive found\nDetails: ${JSON.stringify(
          packageFiles
        )}`
      );
      return undefined;
    }
    const archivePath = await this.artifactProvider.downloadArtifact(
      packageFiles[0]
    );

    const remote = new GitHubRemote(
      githubOwner,
      githubRepo,
    );

    await withTempDir(
      async directory =>
        this.commitArchiveToBranch(
          directory,
          remote,
          branch,
          archivePath,
          version
        ),
      true,
      'craft-gh-pages-'
    );

    this.logger.info('GitHub pages release complete');
  }
}
