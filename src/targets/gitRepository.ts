import simpleGit from 'simple-git';
import { BaseArtifactProvider } from '../artifact_providers/base';
import { TargetConfig } from '../schemas/project_config';
import { ConfigurationError, reportError } from '../utils/errors';
import { withTempDir } from '../utils/files';
import { BaseTarget } from './base';
import childProcess from 'child_process';

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
export class GitRepositoryTarget extends BaseTarget {
  /** Target name */
  public readonly name: string = 'git-repository';

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

    this.logger.debug('Finding archive...');

    const archives = await this.getArtifactsForRevision(revision, {
      includeNames: new RegExp(archive),
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

    await withTempDir(
      async directory => {
        const git = simpleGit(directory);

        this.logger.info(`Cloning ${repositoryUrl} into ${directory}...`);
        await git.clone(repositoryUrl, directory);

        this.logger.info(`Checking out branch "${branch}"...`);
        await git.checkout(branch);

        this.logger.info(`Remove previous files...`);
        await git.raw('rm', '-r', '.');

        if (stripComponents && stripComponents > 0) {
          this.logger.info(
            `Defined --strip-components depth as ${stripComponents}`
          );
        }
        this.logger.info(`Unpack tarball archive at "${archivePath}"...`);
        const stripComponentsArg =
          stripComponents && stripComponents > 0
            ? ` --strip-components ${stripComponents}`
            : '';
        childProcess.execSync(`tar -zxvf ${archivePath}${stripComponentsArg}`, {
          cwd: directory,
        });

        this.logger.info(`Staging files...`);
        await git.raw('add', '--all');

        this.logger.info(`Creating commit...`);
        await git.commit(`release: ${version}`);

        if (createTag) {
          this.logger.info(`Adding a tag "${version}"...`);
          await git.addTag(version);
        } else {
          this.logger.info(`Not adding a tag because it was disabled.`);
        }

        this.logger.info(`Pushing changes to repository...`);
        await git.raw('push', '--force');

        if (createTag) {
          this.logger.info(`Pushing tag...`);
          await git.pushTags();
        }
      },
      true,
      'craft-git-repository-target-'
    );
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
