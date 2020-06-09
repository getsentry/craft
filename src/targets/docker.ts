import { logger as loggerRaw } from '../logger';
import { TargetConfig } from '../schemas/project_config';
import { BaseArtifactProvider } from '../artifact_providers/base';
import { ConfigurationError } from '../utils/errors';
import { checkExecutableIsPresent, spawnProcess } from '../utils/system';
import { BaseTarget } from './base';

const logger = loggerRaw.withScope('[docker]');

const DEFAULT_DOCKER_BIN = 'docker';

/**
 * Command to launch docker
 */
const DOCKER_BIN = process.env.DOCKER_BIN || DEFAULT_DOCKER_BIN;

/** Options for "docker" target */
export interface DockerTargetOptions extends TargetConfig {
  username: string;
  password: string;
  /** Source image path, like `us.gcr.io/sentryio/carft` */
  source: string;
  /** Target image path, like `getsentry/craft` */
  target: string;
}

/**
 * Target responsible for publishing releases on Docker Hub (https://hub.docker.com)
 */
export class DockerTarget extends BaseTarget {
  /** Target name */
  public readonly name: string = 'docker';
  /** Target options */
  public readonly dockerConfig: DockerTargetOptions;

  public constructor(config: any, artifactProvider: BaseArtifactProvider) {
    super(config, artifactProvider);
    this.dockerConfig = this.getDockerConfig();
    checkExecutableIsPresent(DOCKER_BIN);
  }

  /**
   * Extracts Docker target options from the environment
   */
  public getDockerConfig(): DockerTargetOptions {
    if (!process.env.DOCKER_USERNAME || !process.env.DOCKER_PASSWORD) {
      throw new ConfigurationError(
        `Cannot perform Docker release: missing credentials.
         Please use DOCKER_USERNAME and DOCKER_PASSWORD environment variables.`.replace(
          /^\s+/gm,
          ''
        )
      );
    }
    return {
      password: process.env.DOCKER_PASSWORD,
      source: this.config.source,
      target: this.config.target,
      username: process.env.DOCKER_USERNAME,
    };
  }

  /**
   * Logs into docker client with the provided username and password in config
   *
   * NOTE: This may change the globally logged in Docker user on the system
   */
  public async login(): Promise<any> {
    const { username, password } = this.dockerConfig;
    return spawnProcess(DOCKER_BIN, [
      'login',
      `--username=${username}`,
      `--password=${password}`,
    ]);
  }

  /**
   * Pushes the the source image into local
   * @param revision Image tag, usually the git revision
   */
  public async pull(revision: string): Promise<any> {
    logger.debug('Pulling source image...');
    return spawnProcess(
      DOCKER_BIN,
      ['pull', `${this.dockerConfig.source}:${revision}`],
      {},
      { enableInDryRunMode: true }
    );
  }

  /**
   * Pushes the locally tagged source image to Docker Hub
   * @param sourceRevision The tag/revision for the source image
   * @param targetTag The target tag (release version) for the target image
   */
  public async push(sourceRevision: string, targetTag: string): Promise<any> {
    const { source, target } = this.dockerConfig;
    const targetImageName = `${target}:${targetTag}`;
    logger.debug('Tagging target image...');
    await spawnProcess(DOCKER_BIN, [
      'tag',
      `${source}:${sourceRevision}`,
      targetImageName,
    ]);
    return spawnProcess(DOCKER_BIN, ['push', target], {}, { showStdout: true });
  }

  /**
   * Pushes a source image to Docker Hub
   *
   * @param version The new version
   * @param revision The SHA revision of the new version
   */
  public async publish(_version: string, revision: string): Promise<any> {
    await this.login();
    await this.pull(revision);
    await this.push(revision, _version);

    logger.info('Docker release complete');
  }
}