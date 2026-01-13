import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import { createGitClient } from '../utils/git';

import { BaseTarget } from './base';
import { withTempDir } from '../utils/files';
import { checkExecutableIsPresent, spawnProcess } from '../utils/system';
import { GitHubGlobalConfig, TargetConfig } from '../schemas/project_config';
import { BaseArtifactProvider } from '../artifact_providers/base';
import { reportError } from '../utils/errors';
import { logger } from '../logger';

const DEFAULT_MIX_BIN = 'mix';

/**
 * Command to launch mix
 */
const MIX_BIN = process.env.MIX_BIN || DEFAULT_MIX_BIN;

/**
 * Target responsible for publishing releases to Hex, the Elixir/Erlang package manager.
 * https://hex.pm
 *
 * NOTE: This target runs `mix deps.get` and `mix hex.publish` which compile the project
 * as part of normal Elixir/Mix tooling behavior. Unlike npm's lifecycle scripts, these
 * are not arbitrary user-defined scripts but standard build tooling operations required
 * for publishing. There is no `--ignore-scripts` equivalent as Elixir does not have the
 * concept of user-defined publish lifecycle hooks.
 */
export class HexTarget extends BaseTarget {
  /** Target name */
  public readonly name: string = 'hex';
  /** GitHub repo configuration */
  public readonly githubRepo: GitHubGlobalConfig;

  /**
   * Bump version in mix.exs for Elixir projects.
   *
   * @param rootDir - Project root directory
   * @param newVersion - New version string to set
   * @returns true if version was bumped, false if no mix.exs exists
   * @throws Error if file cannot be updated
   */
  public static async bumpVersion(
    rootDir: string,
    newVersion: string
  ): Promise<boolean> {
    const mixExsPath = join(rootDir, 'mix.exs');
    if (!existsSync(mixExsPath)) {
      return false;
    }

    const content = readFileSync(mixExsPath, 'utf-8');
    const versionPatterns = [
      /^(\s*version:\s*["'])([^"']+)(["'])/m,
      /^(\s*@version\s+["'])([^"']+)(["'])/m,
    ];

    let newContent = content;
    let updated = false;

    for (const pattern of versionPatterns) {
      if (pattern.test(newContent)) {
        newContent = newContent.replace(pattern, `$1${newVersion}$3`);
        updated = true;
      }
    }

    if (!updated) {
      logger.debug('No version pattern found in mix.exs');
      return false;
    }

    if (newContent === content) {
      logger.debug('Version already set to target value');
      return true;
    }

    logger.debug(`Updating version in ${mixExsPath} to ${newVersion}`);
    writeFileSync(mixExsPath, newContent);

    return true;
  }

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
    const git = createGitClient(directory);
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
        await spawnProcess(
          MIX_BIN,
          ['local.hex', '--force'],
          spawnOptions,
          spawnProcessOptions
        );
        await spawnProcess(
          MIX_BIN,
          ['local.rebar', '--force'],
          spawnOptions,
          spawnProcessOptions
        );
        await spawnProcess(
          MIX_BIN,
          ['deps.get'],
          spawnOptions,
          spawnProcessOptions
        );
        await spawnProcess(
          MIX_BIN,
          ['hex.publish', '--yes'],
          spawnOptions,
          spawnProcessOptions
        );
      },
      true,
      'craft-hex-'
    );

    this.logger.info('Hex release complete');
  }
}
