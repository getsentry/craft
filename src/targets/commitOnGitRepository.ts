import simpleGit from 'simple-git';
import { BaseArtifactProvider } from '../artifact_providers/base';
import { TargetConfig } from '../schemas/project_config';
import { ConfigurationError, reportError } from '../utils/errors';
import { withTempDir } from '../utils/files';
import { BaseTarget } from './base';
import childProcess from 'child_process';
import type { Consola } from 'consola';
import { isDryRun } from '../utils/helpers';
import { URL } from 'url';

interface GitRepositoryTargetConfig {
  archive: string;
  repositoryUrl: string;
  branch: string;
  createTag: boolean;
  stripComponents?: number;
}

/**
 * Target responsible for pushing code to a git repository.
 */
export class CommitOnGitRepositoryTarget extends BaseTarget {
  /** Target name */
  public readonly name: string = 'commit-on-git-repository';

  public constructor(
    config: TargetConfig,
    artifactProvider: BaseArtifactProvider
  ) {
    super(config, artifactProvider);
  }

  /**
   * Pushes a tarball archive to a repository.
   *
   * @param version New version to be released
   * @param revision Git commit SHA to be published
   */
  public async publish(version: string, revision: string): Promise<void> {
    const {
      archive,
      branch,
      repositoryUrl,
      createTag,
      stripComponents,
    } = this.getGitRepositoryTargetConfig();

    this.logger.info(`Finding archive with regexp "${archive}"...`);

    const archives = await this.getArtifactsForRevision(revision, {
      includeNames: archive,
    });

    if (archives.length === 0) {
      reportError('Cannot push to repository: no archive found!');
      return;
    }

    if (archives.length > 1) {
      reportError('Cannot push to repository: more than one archive found!');
      return;
    }

    this.logger.debug('Downloading archive...');

    const archivePath = await this.artifactProvider.downloadArtifact(
      archives[0]
    );

    this.logger.info('Downloading archive complete');

    await pushArchiveToGitRepository({
      archivePath,
      branch,
      createTag,
      repositoryUrl,
      stripComponents,
      version,
      logger: this.logger,
    });
  }

  private getGitRepositoryTargetConfig(): GitRepositoryTargetConfig {
    if (typeof this.config['archive'] !== 'string') {
      throw new ConfigurationError(
        `\`archive\` option has invalid value ${this.config['archive']}. Needs to be RegExp in the form of a string.`
      );
    }

    if (typeof this.config['repositoryUrl'] !== 'string') {
      throw new ConfigurationError(
        `\`repositoryUrl\` option has invalid value ${this.config['repositoryUrl']}. Needs to be string.`
      );
    }

    if (typeof this.config['branch'] !== 'string') {
      throw new ConfigurationError(
        `\`repositoryUrl\` option has invalid value ${this.config['branch']}. Needs to be string.`
      );
    }

    return {
      archive: this.config['archive'],
      repositoryUrl: this.config['repositoryUrl'],
      branch: this.config['branch'],
      createTag: this.config['createTag'] ?? true,
      stripComponents: this.config['stripComponents'],
    };
  }
}

/**
 * Just a function that we can test
 */
export async function pushArchiveToGitRepository({
  repositoryUrl,
  branch,
  stripComponents,
  archivePath,
  version,
  createTag,
  logger,
}: {
  repositoryUrl: string;
  branch: string;
  stripComponents: number | undefined;
  archivePath: string;
  version: string;
  createTag: boolean;
  logger?: Consola;
}) {
  await withTempDir(
    async directory => {
      const git = simpleGit(directory);

      logger?.info(`Cloning ${repositoryUrl} into ${directory}...`);

      let parsedUrl;
      try {
        parsedUrl = new URL(repositoryUrl);
      } catch (e) {
        logger?.error(
          `Error while parsing \`repositoryUrl\`. Make sure this is a valid URL using the http or https protocol!`
        );
        throw e;
      }

      if (parsedUrl.host === 'github.com' && process.env.GITHUB_API_TOKEN) {
        logger?.info('Using provided github PAT token for authentication.');
        parsedUrl.username = process.env.GITHUB_API_TOKEN;
      }

      const authenticatedUrl = parsedUrl.toString();

      await git.clone(authenticatedUrl, directory);

      logger?.info(`Checking out branch "${branch}"...`);
      await git.checkout(branch);

      logger?.info(`Remove previous files...`);
      await git.raw('rm', '-r', '.');

      if (stripComponents && stripComponents > 0) {
        logger?.info(`Defined --strip-components depth as ${stripComponents}`);
      }
      logger?.info(`Unpack tarball archive at "${archivePath}"...`);
      const stripComponentsArg =
        stripComponents && stripComponents > 0
          ? ` --strip-components ${stripComponents}`
          : '';
      childProcess.execSync(`tar -zxvf ${archivePath}${stripComponentsArg}`, {
        cwd: directory,
      });

      logger?.info(`Staging files...`);
      await git.raw('add', '--all');

      logger?.info(`Creating commit...`);
      if (!isDryRun()) {
        await git.commit(`release: ${version}`);
      }

      if (createTag) {
        logger?.info(`Adding a tag "${version}"...`);
        if (!isDryRun()) {
          await git.addTag(version);
        }
      } else {
        logger?.info(`Not adding a tag because it was disabled.`);
      }

      logger?.info(`Pushing changes to repository...`);
      if (!isDryRun()) {
        await git.raw('push', authenticatedUrl, '--force');
      }

      if (createTag) {
        logger?.info(`Pushing tag...`);
        if (!isDryRun()) {
          await git.raw('push', authenticatedUrl, '--tags');
        }
      }
    },
    true,
    'craft-git-repository-target-'
  );
}
