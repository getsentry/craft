import * as fs from 'fs';

import { Octokit } from '@octokit/rest';

import {
  GitHubGlobalConfig,
  TargetConfig,
  TypedTargetConfig,
} from '../schemas/project_config';
import { sleep } from '../utils/async';
import { ConfigurationError, reportError } from '../utils/errors';
import { withTempDir } from '../utils/files';
import {
  getGitHubApiToken,
  getGitHubClient,
  GitHubRemote,
} from '../utils/githubApi';
import { cloneRepo } from '../utils/git';
import { isDryRun } from '../utils/helpers';
import { extractZipArchiveWithFlattening } from '../utils/system';
import { BaseTarget } from './base';
import { BaseArtifactProvider } from '../artifact_providers/base';

/** GH Pages target configuration fields */
interface GhPagesConfigFields extends Record<string, unknown> {
  branch?: string;
  githubOwner?: string;
  githubRepo?: string;
}

/**
 * Regex for docs archives
 */
const DEFAULT_DEPLOY_ARCHIVE_REGEX = /^(?:.+-)?gh-pages\.zip$/;

const DEFAULT_DEPLOY_BRANCH = 'gh-pages';

/** Delay between reads of the latest GitHub Pages build */
const PAGES_BUILD_POLL_INTERVAL_MS = 10 * 1000;

/**
 * Reads per build attempt: 15 minutes. GitHub's deploy job alone can take
 * up to 10 minutes before actions/deploy-pages gives up.
 */
const PAGES_BUILD_MAX_POLLS = 90;

/** Rebuilds to request after the first GitHub Pages build fails */
const PAGES_MAX_REBUILDS = 2;

/** Subset of a GitHub Pages build that the target reads */
interface PagesBuild {
  url: string;
  status: string;
  commit: string;
  error: { message: string | null };
}

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
    githubRepo: GitHubGlobalConfig,
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
    const config = this.config as TypedTargetConfig<GhPagesConfigFields>;
    let githubOwner;
    let githubRepo;
    if (config.githubOwner && config.githubRepo) {
      githubOwner = config.githubOwner;
      githubRepo = config.githubRepo;
    } else if (!config.githubOwner && !config.githubRepo) {
      githubOwner = this.githubRepo.owner;
      githubRepo = this.githubRepo.repo;
    } else {
      throw new ConfigurationError(
        '[gh-pages] Invalid repository configuration: check repo owner and name',
      );
    }

    const branch = config.branch || DEFAULT_DEPLOY_BRANCH;

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
    directory: string,
  ): Promise<void> {
    // Check that the directory is empty
    const dirContents = fs.readdirSync(directory).filter(f => f !== '.git');
    if (dirContents.length > 0) {
      throw new Error(
        'Destination directory is not empty: cannot extract the acrhive!',
      );
    }

    // Extract the archive (flattening a single top-level directory if present)
    this.logger.info(`Extracting "${archivePath}" to "${directory}"...`);
    await extractZipArchiveWithFlattening(archivePath, directory);
  }

  /**
   * Extracts the contents of the given archive, and then commits them
   *
   * @param directory Path to the git repo
   * @param remote Object representing GitHub remote
   * @param branch Branch to push
   * @param archivePath Path to the archive
   * @param version Version to deploy
   * @returns SHA of the pushed commit
   */
  public async commitArchiveToBranch(
    directory: string,
    remote: GitHubRemote,
    branch: string,
    archivePath: string,
    version: string,
  ): Promise<string> {
    this.logger.info(
      `Cloning "${remote.getRemoteString()}" to "${directory}"...`,
    );
    const git = await cloneRepo(remote.getRemoteStringWithAuth(), directory);
    this.logger.debug(`Checking out branch: "${branch}"`);
    try {
      await git.checkout([branch]);
    } catch (e) {
      if (!e.message.match(/pathspec .* did not match any file/)) {
        throw e;
      }
      this.logger.debug(
        `Branch ${branch} does not exist, creating a new orphaned branch...`,
      );
      await git.checkout(['--orphan', branch]);
    }

    // Additional check, just in case
    const repoStatus = await git.status();
    if (repoStatus.current !== 'No' && repoStatus.current !== branch) {
      throw new Error(
        `Something went very wrong: cannot switch to branch "${branch}"`,
      );
    }

    // Clean the previous state
    this.logger.debug(`Removing existing files from the working tree...`);
    await git.rm(['-r', '-f', '.']);

    // Extract the archive
    await this.extractAssets(archivePath, directory);

    await git.add(['.']);
    await git.commit(`craft(gh-pages): update, version "${version}"`);

    this.logger.info(`Pushing branch "${branch}"...`);
    await git.push('origin', branch, ['--set-upstream']);
    return (await git.revparse(['HEAD'])).trim();
  }

  /**
   * Waits until GitHub Pages builds the pushed commit, and requests a
   * rebuild when the build fails.
   *
   * A push to the branch only starts the build. GitHub can fail the build
   * later, for example when its deploy job times out (getsentry/craft#960).
   * Skips the wait when the token cannot read Pages, or when Pages does not
   * build from the configured branch.
   *
   * @param sha SHA of the pushed commit
   */
  public async waitForPagesBuild(sha: string): Promise<void> {
    const { githubOwner: owner, githubRepo: repo, branch } = this.ghPagesConfig;

    let pages;
    try {
      pages = (await this.github.repos.getPages({ owner, repo })).data;
    } catch (e) {
      if (e.status === 403 || e.status === 404) {
        this.logger.warn(
          `Cannot read GitHub Pages settings of ${owner}/${repo} (HTTP ${e.status}), not waiting for the Pages build.`,
        );
        return;
      }
      throw e;
    }
    if (pages.build_type !== 'legacy' || pages.source?.branch !== branch) {
      this.logger.info(
        `GitHub Pages of ${owner}/${repo} does not build from branch "${branch}", not waiting for the Pages build.`,
      );
      return;
    }

    let failedBuild: PagesBuild | undefined;
    for (let attempt = 0; attempt <= PAGES_MAX_REBUILDS; attempt++) {
      if (attempt > 0) {
        this.logger.warn(
          `GitHub Pages build failed (${describePagesBuild(failedBuild)}), requesting rebuild ${attempt}/${PAGES_MAX_REBUILDS}...`,
        );
        await this.github.repos.requestPagesBuild({ owner, repo });
      }
      const build = await this.pollPagesBuild(sha, failedBuild?.url);
      if (build?.status === 'built') {
        this.logger.info(`GitHub Pages build for ${sha} is complete.`);
        return;
      }
      failedBuild = build ?? failedBuild;
    }

    reportError(
      `GitHub Pages build for ${sha} failed after ${PAGES_MAX_REBUILDS} rebuilds (${describePagesBuild(failedBuild)}). ` +
        `See https://github.com/${owner}/${repo}/deployments/github-pages`,
    );
  }

  /**
   * Reads the latest GitHub Pages build until the build for `sha` finishes
   *
   * @param sha SHA of the pushed commit
   * @param ignoreUrl URL of an earlier failed build of the same commit
   * @returns The finished build, or undefined when the wait timed out
   */
  private async pollPagesBuild(
    sha: string,
    ignoreUrl?: string,
  ): Promise<PagesBuild | undefined> {
    const { githubOwner: owner, githubRepo: repo } = this.ghPagesConfig;
    for (let poll = 0; poll < PAGES_BUILD_MAX_POLLS; poll++) {
      await sleep(PAGES_BUILD_POLL_INTERVAL_MS);
      const build: PagesBuild = (
        await this.github.repos.getLatestPagesBuild({ owner, repo })
      ).data;
      if (
        build.commit === sha &&
        build.url !== ignoreUrl &&
        (build.status === 'built' || build.status === 'errored')
      ) {
        return build;
      }
      this.logger.debug(
        `Latest GitHub Pages build: ${build.status} for ${build.commit}`,
      );
    }
    return undefined;
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
          packageFiles,
        )}`,
      );
      return undefined;
    }
    const archivePath = await this.artifactProvider.downloadArtifact(
      packageFiles[0],
    );

    const remote = new GitHubRemote(
      githubOwner,
      githubRepo,
      getGitHubApiToken(),
    );

    const sha = await withTempDir(
      async directory =>
        this.commitArchiveToBranch(
          directory,
          remote,
          branch,
          archivePath,
          version,
        ),
      true,
      'craft-gh-pages-',
    );

    // The push did not happen, so there is no build to wait for. This also
    // keeps requestPagesBuild out of dry-run: the dry-run GitHub client does
    // not treat "request*" methods as mutating.
    if (isDryRun()) {
      this.logger.info('[dry-run] Not waiting for the GitHub Pages build.');
    } else {
      await this.waitForPagesBuild(sha);
    }

    this.logger.info('GitHub pages release complete');
  }
}

/** Describes a failed Pages build for logs and errors */
function describePagesBuild(build: PagesBuild | undefined): string {
  if (!build) {
    return 'timed out';
  }
  return build.error.message || build.status;
}
