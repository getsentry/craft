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

/** Docker Hub registry hostnames that should be treated as the default registry */
const DOCKER_HUB_REGISTRIES = ['docker.io', 'index.docker.io', 'registry-1.docker.io'];

/**
 * Extracts the registry host from a Docker image path.
 *
 * @param imagePath Docker image path (e.g., "ghcr.io/user/image" or "user/image")
 * @returns The registry host if present (e.g., "ghcr.io"), undefined for Docker Hub
 */
export function extractRegistry(imagePath: string): string | undefined {
  const parts = imagePath.split('/');
  // Registry hosts contain dots (ghcr.io, gcr.io, us.gcr.io, etc.)
  // or colons for ports (localhost:5000)
  if (parts.length >= 2 && (parts[0].includes('.') || parts[0].includes(':'))) {
    const registry = parts[0];
    // Treat Docker Hub registries as the default (return undefined)
    if (DOCKER_HUB_REGISTRIES.includes(registry)) {
      return undefined;
    }
    return registry;
  }
  return undefined;
}

/**
 * Converts a registry hostname to an environment variable prefix.
 *
 * @param registry Registry hostname (e.g., "ghcr.io", "us.gcr.io")
 * @returns Environment variable prefix (e.g., "GHCR_IO", "US_GCR_IO")
 */
export function registryToEnvPrefix(registry: string): string {
  return registry.toUpperCase().replace(/[.\-:]/g, '_');
}

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
  /** Registry host for docker login (e.g., "ghcr.io"). Auto-detected from target if not specified. */
  registry?: string;
}

/**
 * Target responsible for publishing releases to Docker registries.
 *
 * Supports multiple registries including Docker Hub, GitHub Container Registry (ghcr.io),
 * Google Container Registry (gcr.io), and other OCI-compliant registries.
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
   * Extracts Docker target options from the environment.
   *
   * Credential resolution follows two modes:
   *
   * Mode A (explicit env vars): If usernameVar or passwordVar is configured,
   * both must be specified and the env vars must exist. No fallback for security.
   *
   * Mode B (automatic resolution): Tries in order:
   * 1. Registry-derived env vars: DOCKER_<REGISTRY>_USERNAME / DOCKER_<REGISTRY>_PASSWORD
   * 2. Built-in defaults for known registries (GHCR: GITHUB_ACTOR / GITHUB_TOKEN)
   * 3. Default: DOCKER_USERNAME / DOCKER_PASSWORD
   */
  public getDockerConfig(): DockerTargetOptions {
    const registry =
      this.config.registry ?? extractRegistry(this.config.target);

    let username: string | undefined;
    let password: string | undefined;

    // Mode A: Explicit env var override - no fallback for security
    if (this.config.usernameVar || this.config.passwordVar) {
      if (!this.config.usernameVar || !this.config.passwordVar) {
        throw new ConfigurationError(
          'Both usernameVar and passwordVar must be specified together'
        );
      }
      username = process.env[this.config.usernameVar];
      password = process.env[this.config.passwordVar];

      if (!username || !password) {
        throw new ConfigurationError(
          `Missing credentials: ${this.config.usernameVar} and/or ${this.config.passwordVar} environment variable(s) not set`
        );
      }
    } else {
      // Mode B: Automatic resolution with fallback chain

      // 1. Registry-derived env vars
      if (registry) {
        const prefix = `DOCKER_${registryToEnvPrefix(registry)}_`;
        username = process.env[`${prefix}USERNAME`];
        password = process.env[`${prefix}PASSWORD`];
      }

      // 2. Built-in defaults for known registries
      if (!username || !password) {
        if (registry === 'ghcr.io') {
          // GHCR defaults: use GitHub Actions built-in env vars
          // GITHUB_ACTOR and GITHUB_TOKEN are available by default in GitHub Actions
          // See: https://docs.github.com/en/actions/reference/workflows-and-actions/variables
          username = username ?? process.env.GITHUB_ACTOR;
          password = password ?? process.env.GITHUB_TOKEN;
        }
      }

      // 3. Fallback to defaults
      username = username ?? process.env.DOCKER_USERNAME;
      password = password ?? process.env.DOCKER_PASSWORD;
    }

    if (!username || !password) {
      const registryHint = registry
        ? `DOCKER_${registryToEnvPrefix(registry)}_USERNAME/PASSWORD or `
        : '';
      throw new ConfigurationError(
        `Cannot perform Docker release: missing credentials.
Please use ${registryHint}DOCKER_USERNAME and DOCKER_PASSWORD environment variables.`.replace(
          /^\s+/gm,
          ''
        )
      );
    }

    return {
      password,
      source: this.config.source,
      target: this.config.target,
      sourceTemplate: this.config.sourceFormat || '{{{source}}}:{{{revision}}}',
      targetTemplate: this.config.targetFormat || '{{{target}}}:{{{version}}}',
      username,
      registry,
    };
  }

  /**
   * Logs into docker client with the provided username and password in config
   *
   * NOTE: This may change the globally logged in Docker user on the system
   */
  public async login(): Promise<any> {
    const { username, password, registry } = this.dockerConfig;
    const args = ['login', `--username=${username}`, '--password-stdin'];
    if (registry) {
      args.push(registry);
    }
    // Pass password via stdin for security (avoids exposure in ps/process list)
    return spawnProcess(DOCKER_BIN, args, {}, { stdin: password });
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
   * Publishes a source image to the target registry
   *
   * @param version The new version
   * @param revision The SHA revision of the new version
   */
  public async publish(version: string, revision: string): Promise<any> {
    await this.login();
    await this.copy(revision, version);

    this.logger.info('Docker release complete');
  }
}
