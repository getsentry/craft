import { constants, promises as fsPromises } from 'fs';
import { join } from 'path';
import { BaseArtifactProvider } from 'src/artifact_providers/base';
import { checkEnvForPrerequisite } from 'src/utils/env';
import { checkExecutableIsPresent, spawnProcess } from 'src/utils/system';
import { GitHubGlobalConfig, TargetConfig } from '../schemas/project_config';
import { BaseTarget } from './base';
import * as os from 'os';
import { withTempDir } from 'src/utils/files';
import simpleGit from 'simple-git';
import { forEachChained } from 'src/utils/async';

export const targetSecrets = [
  'PUBDEV_ACCESS_TOKEN',
  'PUBDEV_REFRESH_TOKEN',
] as const;
type SecretsType = typeof targetSecrets[number];

/** Target options for "brew" */
export interface PubDevTargetOptions {
  /** Path to the Dart CLI. It must be executable by the calling process. */
  dartCliPath: string;
  /** List of directories to be released. Useful when a single repository contains multiple packages. */
  packages: string[];
}

/**
 * Config options for the "pub-dev" target.
 */
export type PubDevTargetConfig = PubDevTargetOptions &
  Record<SecretsType, string>;

type PartialTargetConfig = { name: string; value: string | undefined }[];

/**
 * Target responsible for uploading files to pub.dev.
 */
export class PubDevTarget extends BaseTarget {
  /** Target name */
  public readonly name: string = 'pub-dev';
  /** Target options */
  public readonly pubDevConfig: PubDevTargetConfig;
  /** GitHub repo configuration */
  public readonly githubRepo: GitHubGlobalConfig;

  public constructor(
    config: TargetConfig,
    artifactProvider: BaseArtifactProvider,
    githubRepo: GitHubGlobalConfig
  ) {
    super(config, artifactProvider, githubRepo);
    this.pubDevConfig = this.getPubDevConfig();
    this.checkRequiredSoftware();
    this.githubRepo = githubRepo;
  }

  /**
   * Returns the pub-dev config with the required data (e.g. environment
   * variables) for this target. If there's a configuration requirement missing,
   * raises an error.
   *
   * @returns the pub-dev config for this target.
   */
  private getPubDevConfig(): PubDevTargetConfig {
    // We could do `...this.config`, but `packages` is in a list, not array format in `.yml`
    // so I wanted to keep setting the defaults unified.
    return {
      dartCliPath: this.config.dartCliPath || 'dart',
      packages: this.config.packages
        ? Object.keys(this.config.packages)
        : ['.'],
      ...this.getTargetSecrets(),
    };
  }

  private getTargetSecrets(): Record<SecretsType, string> {
    const secrets = targetSecrets.map(name => {
      checkEnvForPrerequisite({ name });
      return {
        name,
        value: process.env[name],
      };
    });
    return this.reduceConfig(secrets);
  }

  private reduceConfig(config: PartialTargetConfig): Record<string, string> {
    return config.reduce((prev, current) => {
      return {
        ...prev,
        [current.name]: current.value,
      };
    }, {});
  }

  /**
   * Checks whether the required software to run this target is available
   * in the system. It assumes the config for this target to be available.
   * If there's required software missing, raises an error.
   */
  private checkRequiredSoftware(): void {
    this.logger.debug(
      'Checking if Dart CLI is available: ',
      this.pubDevConfig.dartCliPath
    );
    checkExecutableIsPresent(this.pubDevConfig.dartCliPath);
  }

  /**
   * Uploads all files to pub.dev using Dart CLI.
   *
   * @param version New version to be released
   * @param revision Git commit SHA to be published
   */
  public async publish(_version: string, revision: string): Promise<any> {
    await this.createCredentialsFile();

    await withTempDir(
      async directory => {
        await this.cloneRepository(this.githubRepo, revision, directory);
        await forEachChained(this.pubDevConfig.packages, async pkg =>
          this.publishPackage(directory, pkg)
        );
      },
      true,
      'craft-pub-dev-'
    );
  }

  public async createCredentialsFile(): Promise<void> {
    const credentialsFilePath = this.getCredentialsFilePath();
    const content = {
      accessToken: this.pubDevConfig.PUBDEV_ACCESS_TOKEN,
      refreshToken: this.pubDevConfig.PUBDEV_REFRESH_TOKEN,
      tokenEndpoint: 'https://accounts.google.com/o/oauth2/token',
      scopes: ['openid', 'https://www.googleapis.com/auth/userinfo.email'],
      expiration: 1645564942000, // Expiration date is required, but irrelevant
    };

    // Store credentials file only if they doesn't exist
    try {
      await fsPromises.access(credentialsFilePath, constants.F_OK);
      this.logger.warn('Credentials file already exists. Skipping creation.');
    } catch {
      await fsPromises.writeFile(credentialsFilePath, JSON.stringify(content));
      this.logger.info('Credentials file created.');
    }
  }

  private getCredentialsFilePath(): string {
    const platform = os.platform();
    switch (platform) {
      case 'darwin':
        return `${os.homedir()}/Library/Application Support/dart/pub-credentials.json`;
      case 'linux':
        return `${os.homedir()}/.config/dart/pub-credentials.json`;
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }
  }

  /**
   * Clones a repository.
   *
   * @param config Git configuration specifying the repository to clone.
   * @param revision The commit SHA that should be checked out after the clone.
   * @param directory The directory to clone into.
   */
  public async cloneRepository(
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
   * Publishes a package on pub.dev
   *
   * @param directory The path to the root package
   * @param package The path to the package itself, relative to the root
   * @returns A promise that resolves when the package has been published
   */
  public async publishPackage(directory: string, pkg: string): Promise<void> {
    // `--force` prevents confirmation prompt
    const args = ['pub', 'publish', '--force'];
    await spawnProcess(
      this.pubDevConfig.dartCliPath,
      args,
      {
        cwd: join(directory, pkg),
      },
      // Dart stops the process and asks user to go to provided url for authorization.
      // We want the stdout to be visible just in case something goes wrong, otherwise
      // the process will hang with no clear reason why.
      { showStdout: true }
    );
    this.logger.info(
      `Package release complete${pkg !== '.' ? `: ${pkg}` : '.'}`
    );
  }
}
