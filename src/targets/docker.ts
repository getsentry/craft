import { TargetConfig } from '../schemas/project_config';
import { BaseArtifactProvider } from '../artifact_providers/base';
import { ConfigurationError } from '../utils/errors';
import { renderTemplateSafe } from '../utils/strings';
import { checkExecutableIsPresent, spawnProcess } from '../utils/system';
import { BaseTarget } from './base';

const DEFAULT_DOCKER_BIN = 'docker';

/**
 * Command to launch docker
 */
const DOCKER_BIN = process.env.DOCKER_BIN || DEFAULT_DOCKER_BIN;

/** Options for "docker" target */
export interface DockerTargetOptions {
  username: string;
  password: string;
  /** Source image path, like `us.gcr.io/sentryio/craft` */
  source: string;
  /** Full name template for the source image path, defaults to `{{{source}}}:{{{revision}}}` */
  sourceTemplate: string;
  /** Full name template for the target image path, defaults to `{{{target}}}:{{{version}}}` */
  targetTemplate: string;
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

  public constructor(
    config: TargetConfig,
    artifactProvider: BaseArtifactProvider
  ) {
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
      sourceTemplate: this.config.sourceFormat || '{{{source}}}:{{{revision}}}',
      targetTemplate: this.config.targetFormat || '{{{target}}}:{{{version}}}',
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
  async pull(revision: string): Promise<any> {
    this.logger.debug('Pulling source image...');
    const sourceImage = renderTemplateSafe(this.dockerConfig.sourceTemplate, {
      ...this.dockerConfig,
      revision,
    });
    return spawnProcess(
      DOCKER_BIN,
      ['pull', sourceImage],
      {},
      { enableInDryRunMode: true }
    );
  }

  /**
   * Pushes the locally tagged source image to Docker Hub
   * @param sourceRevision The tag/revision for the source image
   * @param version The release version for the target image
   */
  async push(sourceRevision: string, version: string): Promise<any> {
    const sourceImage = renderTemplateSafe(this.dockerConfig.sourceTemplate, {
      ...this.dockerConfig,
      revision: sourceRevision,
    });
    const targetImage = renderTemplateSafe(this.dockerConfig.targetTemplate, {
      ...this.dockerConfig,
      version,
    });
    this.logger.debug('Tagging target image...');
    await spawnProcess(DOCKER_BIN, ['tag', sourceImage, targetImage]);
    return spawnProcess(
      DOCKER_BIN,
      ['push', targetImage],
      {},
      { showStdout: true }
    );
  }

  /**
   * Checks whether Docker BuildKit is installed.
   */
  async hasBuildKit(): Promise<boolean> {
    return spawnProcess(DOCKER_BIN, ['buildx', 'version']).then(() => true).catch(() => false);
  }

  /**
   * Copies an existing local or remote docker image to a new destination.
   *
   * Requires BuildKit / `docker buildx` to be installed.
   *
   * @param sourceRevision The tag/revision for the source image
   * @param version The release version for the target image
   */
  async copy(sourceRevision: string, version: string): Promise<any> {
    const sourceImage = renderTemplateSafe(this.dockerConfig.sourceTemplate, {
      ...this.dockerConfig,
      revision: sourceRevision,
    });
    const targetImage = renderTemplateSafe(this.dockerConfig.targetTemplate, {
      ...this.dockerConfig,
      version,
    });

    this.logger.debug(`Copying image from ${sourceImage} to ${targetImage}...`);
    return spawnProcess(
      DOCKER_BIN,
      ['buildx', 'imagetools', 'create', '--tag', targetImage, sourceImage],
      {},
      { showStdout: true }
    );
  }

  /**
   * Pushes a source image to Docker Hub
   *
   * @param version The new version
   * @param revision The SHA revision of the new version
   */
  public async publish(version: string, revision: string): Promise<any> {
    await this.login();

    if (await this.hasBuildKit()) {
      await this.copy(revision, version);
    } else {
      // Fall back to slow/old pull and push method.
      await this.pull(revision);
      await this.push(revision, version);
    }

    this.logger.info('Docker release complete');
  }
}
