import simpleGit from 'simple-git';

import { BaseTarget } from './base';
import { withTempDir } from '../utils/files';
import { checkExecutableIsPresent, spawnProcess } from '../utils/system';
import { GitHubGlobalConfig, TargetConfig } from '../schemas/project_config';
import { BaseArtifactProvider } from '../artifact_providers/base';
import { reportError } from '../utils/errors';

const DEFAULT_MIX_BIN = 'mix';

/**
 * Command to launch mix
 */
const MIX_BIN = process.env.MIX_BIN || DEFAULT_MIX_BIN;

/**
 * Target responsible for publishing releases to Hex, the Elixir/Erlang package manager.
 * https://hex.pm
 */
export class HexTarget extends BaseTarget {
  /** Target name */
  public readonly name: string = 'hex';
  /** GitHub repo configuration */
  public readonly githubRepo: GitHubGlobalConfig;

  public constructor(
    config: TargetConfig,
    artifactProvider: BaseArtifactProvider,
    githubRepo: GitHubGlobalConfig
  ) {
    super(config, artifactProvider, githubRepo);
    checkExecutableIsPresent(MIX_BIN);
    this.checkApiKey();
    this.githubRepo = githubRepo;
  }

  /**
   * Check that API key is set in env for publishing.
   */
  checkApiKey() {
    if (!process.env.HEX_API_KEY) {
      reportError(
        `Cannot publish to hex.pm: missing credentials.
         Please use HEX_API_KEY environment variable to pass the API token.`
      );
    }
  }

  /**
   * Clones a repository.
   *
   * @param config Git configuration specifying the repository to clone.
   * @param revision The commit SHA that should be checked out after the clone.
   * @param directory The directory to clone into.
   */
  async cloneRepository(
    config: GitHubGlobalConfig,
    revision: string,
    directory: string
  ): Promise<any> {
    const { owner, repo } = config;
    const git = simpleGit(directory);
    const url = `https://github.com/${owner}/${repo}.git`;

    this.logger.info(`Cloning ${owner}/${repo} into ${directory}`);
    await git.clone(url, directory);
    await git.checkout(revision);
  }

  /**
   * Publishes package to hex.pm using mix hex.publish
   *
   * @param version New version to be released
   * @param revision Git commit SHA to be published
   */
  public async publish(_version: string, revision: string): Promise<any> {
    await withTempDir(
      async directory => {
        await this.cloneRepository(this.githubRepo, revision, directory);

        const spawnOptions = { cwd: directory };
        const spawnProcessOptions = { showStdout: true };
        await spawnProcess(MIX_BIN, ['deps.get'], spawnOptions, spawnProcessOptions);
        await spawnProcess(MIX_BIN, ['hex.publish', '--yes'], spawnOptions, spawnProcessOptions);
      },
      true,
      'craft-hex-'
    );

    this.logger.info('Hex release complete');
  }
}
