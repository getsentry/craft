import * as fs from 'fs';
import * as path from 'path';

import * as Github from '@octokit/rest';
import { shouldPerform } from 'dryrun';
// tslint:disable-next-line:no-submodule-imports
import * as simpleGit from 'simple-git/promise';

import { getGlobalGithubConfig } from '../config';
import { logger as loggerRaw } from '../logger';
import { GithubGlobalConfig, TargetConfig } from '../schemas/project_config';
import { ConfigurationError, reportError } from '../utils/errors';
import { withTempDir } from '../utils/files';
import {
  getAuthUsername,
  getGithubApiToken,
  getGithubClient,
  GithubRemote,
} from '../utils/githubApi';
import { extractZipArchive } from '../utils/system';
import { BaseTarget } from './base';
import { BaseArtifactProvider } from '../artifact_providers/base';

const logger = loggerRaw.withScope('[gh-pages]');

/**
 * Regex for docs archives
 */
const DEFAULT_DEPLOY_ARCHIVE_REGEX = /^(?:.+-)?gh-pages\.zip$/;

const DEFAULT_DEPLOY_BRANCH = 'gh-pages';

/** Target options for "gh-pages" */
export interface GhPagesConfig extends TargetConfig {
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
  /** Github client */
  public readonly github: Github;
  /** Github repo configuration */
  public readonly githubRepo: GithubGlobalConfig;

  public constructor(config: any, artifactProvider: BaseArtifactProvider) {
    super(config, artifactProvider);
    this.github = getGithubClient();
    this.githubRepo = getGlobalGithubConfig();
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
    logger.info(`Extracting "${archivePath}" to "${directory}"...`);
    await extractZipArchive(archivePath, directory);

    // If there's a single top-level directory -- move its contents to the git root
    const newDirContents = fs.readdirSync(directory).filter(f => f !== '.git');
    if (
      newDirContents.length === 1 &&
      fs.statSync(path.join(directory, newDirContents[0])).isDirectory()
    ) {
      logger.debug('Single top-level directory found, moving files from it...');
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
    remote: GithubRemote,
    branch: string,
    archivePath: string,
    version: string
  ): Promise<void> {
    logger.info(`Cloning "${remote.getRemoteString()}" to "${directory}"...`);
    await simpleGit()
      .silent(true)
      .clone(remote.getRemoteStringWithAuth(), directory);
    const git = simpleGit(directory).silent(true);
    logger.debug(`Checking out branch: "${branch}"`);
    try {
      await git.checkout([branch]);
    } catch (e) {
      if (!e.message.match(/pathspec .* did not match any file/)) {
        throw e;
      }
      logger.debug(
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
    logger.debug(`Removing existing files from the working tree...`);
    await git.rm(['-r', '-f', '.']);

    // Extract the archive
    await this.extractAssets(archivePath, directory);

    // Commit
    await git.add(['.']);
    await git.commit(`craft(gh-pages): update, version "${version}"`);

    // Push!
    logger.info(`Pushing branch "${branch}"...`);
    if (shouldPerform()) {
      await git.push('origin', branch, { '--set-upstream': true });
    } else {
      logger.info('[dry-run] Not pushing the branch.');
    }
  }

  /**
   * Pushes an archive with static HTML web assets to the configured branch
   */
  public async publish(version: string, revision: string): Promise<any> {
    const { githubOwner, githubRepo, branch } = this.ghPagesConfig;

    logger.debug('Fetching artifact list from Zeus...');
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

    const username = await getAuthUsername(this.github);

    const remote = new GithubRemote(
      githubOwner,
      githubRepo,
      username,
      getGithubApiToken()
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

    logger.info('Gh-pages release complete');
  }
}
