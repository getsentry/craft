import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

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
 * Google Cloud registry patterns.
 * - gcr.io and regional variants (Container Registry - being deprecated)
 * - *.pkg.dev (Artifact Registry - recommended)
 */
const GCR_REGISTRY_PATTERNS = [
  /^gcr\.io$/,
  /^[a-z]+-gcr\.io$/, // us-gcr.io, eu-gcr.io, asia-gcr.io, etc.
  /^[a-z]+\.gcr\.io$/, // us.gcr.io, eu.gcr.io, asia.gcr.io, etc.
  /^[a-z]+-docker\.pkg\.dev$/, // us-docker.pkg.dev, europe-docker.pkg.dev, etc.
];

/**
 * Checks if a registry is a Google Cloud registry (GCR or Artifact Registry).
 */
export function isGoogleCloudRegistry(registry: string | undefined): boolean {
  if (!registry) return false;
  return GCR_REGISTRY_PATTERNS.some(pattern => pattern.test(registry));
}

/**
 * Checks if gcloud credentials are available in the environment.
 * These are typically set by google-github-actions/auth or `gcloud auth login`.
 *
 * Detection methods:
 * 1. GOOGLE_APPLICATION_CREDENTIALS env var pointing to a valid file
 * 2. GOOGLE_GHA_CREDS_PATH env var (set by google-github-actions/auth)
 * 3. CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE env var
 * 4. Default ADC location: ~/.config/gcloud/application_default_credentials.json
 */
export function hasGcloudCredentials(): boolean {
  // Check environment variables that point to credential files
  const credPaths = [
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    process.env.GOOGLE_GHA_CREDS_PATH,
    process.env.CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE,
  ];

  for (const credPath of credPaths) {
    if (credPath && fs.existsSync(credPath)) {
      return true;
    }
  }

  // Check default Application Default Credentials location
  const defaultAdcPath = path.join(
    os.homedir(),
    '.config',
    'gcloud',
    'application_default_credentials.json'
  );
  if (fs.existsSync(defaultAdcPath)) {
    return true;
  }

  return false;
}

/**
 * Checks if the gcloud CLI is available.
 */
export async function isGcloudAvailable(): Promise<boolean> {
  try {
    await spawnProcess('gcloud', ['--version'], {}, {});
    return true;
  } catch {
    return false;
  }
}

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

/** Credentials for a Docker registry */
export interface RegistryCredentials {
  username: string;
  password: string;
  registry?: string;
}

/**
 * Image reference configuration (object form).
 * Can also be specified as a string shorthand for just the image path.
 */
export interface ImageRefConfig {
  /** Docker image path (e.g., "ghcr.io/user/image" or "user/image") */
  image: string;
  /** Override the registry for credentials (auto-detected from image if not specified) */
  registry?: string;
  /** Format template for the image name */
  format?: string;
  /** Env var name for username (must be used with passwordVar) */
  usernameVar?: string;
  /** Env var name for password (must be used with usernameVar) */
  passwordVar?: string;
  /**
   * Skip docker login for this registry.
   * Use when auth is configured externally (e.g., gcloud workload identity, service account).
   * When true, craft assumes Docker is already authenticated to access this registry.
   */
  skipLogin?: boolean;
}

/** Image reference can be a string (image path) or full config object */
export type ImageRef = string | ImageRefConfig;

/** Legacy config keys for source and target */
interface LegacyConfigKeys {
  format: string;
  registry: string;
  usernameVar: string;
  passwordVar: string;
  skipLogin: string;
}

const LEGACY_KEYS: Record<'source' | 'target', LegacyConfigKeys> = {
  source: {
    format: 'sourceFormat',
    registry: 'sourceRegistry',
    usernameVar: 'sourceUsernameVar',
    passwordVar: 'sourcePasswordVar',
    skipLogin: 'sourceSkipLogin',
  },
  target: {
    format: 'targetFormat',
    registry: 'registry',
    usernameVar: 'usernameVar',
    passwordVar: 'passwordVar',
    skipLogin: 'skipLogin',
  },
};

/**
 * Normalizes an image reference to object form.
 * Handles backwards compatibility with legacy flat config.
 *
 * @param config The full target config object
 * @param type Whether this is 'source' or 'target' image reference
 */
export function normalizeImageRef(
  config: Record<string, unknown>,
  type: 'source' | 'target'
): ImageRefConfig {
  const ref = config[type] as ImageRef;
  const keys = LEGACY_KEYS[type];

  // Get legacy values from config
  const legacyFormat = config[keys.format] as string | undefined;
  const legacyRegistry = config[keys.registry] as string | undefined;
  const legacyUsernameVar = config[keys.usernameVar] as string | undefined;
  const legacyPasswordVar = config[keys.passwordVar] as string | undefined;
  const legacySkipLogin = config[keys.skipLogin] as boolean | undefined;

  if (typeof ref === 'string') {
    return {
      image: ref,
      format: legacyFormat,
      registry: legacyRegistry,
      usernameVar: legacyUsernameVar,
      passwordVar: legacyPasswordVar,
      skipLogin: legacySkipLogin,
    };
  }

  // Object form - prefer object properties over legacy, but allow legacy as fallback
  return {
    image: ref.image,
    format: ref.format ?? legacyFormat,
    registry: ref.registry ?? legacyRegistry,
    usernameVar: ref.usernameVar ?? legacyUsernameVar,
    passwordVar: ref.passwordVar ?? legacyPasswordVar,
    skipLogin: ref.skipLogin ?? legacySkipLogin,
  };
}

/** Resolved image configuration with credentials */
export interface ResolvedImageConfig extends ImageRefConfig {
  /** Resolved format template (with defaults applied) */
  format: string;
  /** Resolved credentials for this registry (undefined if public/same as other) */
  credentials?: RegistryCredentials;
}

/** Options for "docker" target */
export interface DockerTargetOptions {
  /** Source image configuration with resolved credentials */
  source: ResolvedImageConfig;
  /** Target image configuration with resolved credentials (or skipLogin for external auth) */
  target: ResolvedImageConfig;
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
   * Resolves credentials for a registry.
   *
   * Credential resolution follows two modes:
   *
   * Mode A (explicit env vars): If usernameVar and passwordVar are provided,
   * only those env vars are used. Throws if either is missing.
   *
   * Mode B (automatic resolution): Tries in order:
   * 1. Registry-derived env vars: DOCKER_<REGISTRY>_USERNAME / DOCKER_<REGISTRY>_PASSWORD
   * 2. Built-in defaults for known registries (GHCR: GITHUB_ACTOR / GITHUB_TOKEN)
   * 3. Default: DOCKER_USERNAME / DOCKER_PASSWORD (only if useDefaultFallback is true)
   *
   * @param registry The registry host (e.g., "ghcr.io"), undefined for Docker Hub
   * @param usernameVar Optional explicit env var name for username
   * @param passwordVar Optional explicit env var name for password
   * @param required Whether credentials are required (throws if missing)
   * @param useDefaultFallback Whether to fall back to DOCKER_USERNAME/PASSWORD defaults
   * @returns Credentials if found, undefined if not required and not found
   */
  private resolveCredentials(
    registry: string | undefined,
    usernameVar?: string,
    passwordVar?: string,
    required = true,
    useDefaultFallback = true
  ): RegistryCredentials | undefined {
    let username: string | undefined;
    let password: string | undefined;

    // Mode A: Explicit env var override - no fallback for security
    if (usernameVar || passwordVar) {
      if (!usernameVar || !passwordVar) {
        throw new ConfigurationError(
          'Both usernameVar and passwordVar must be specified together'
        );
      }
      username = process.env[usernameVar];
      password = process.env[passwordVar];

      if (!username || !password) {
        if (required) {
          throw new ConfigurationError(
            `Missing credentials: ${usernameVar} and/or ${passwordVar} environment variable(s) not set`
          );
        }
        return undefined;
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

      // 3. Fallback to defaults (only for target registry, not for source)
      if (useDefaultFallback) {
        username = username ?? process.env.DOCKER_USERNAME;
        password = password ?? process.env.DOCKER_PASSWORD;
      }
    }

    if (!username || !password) {
      if (required) {
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
      return undefined;
    }

    return { username, password, registry };
  }

  /**
   * Extracts Docker target options from the environment.
   *
   * Supports both new nested config format and legacy flat format:
   *
   * New format:
   *   source: { image: "ghcr.io/org/image", registry: "ghcr.io", usernameVar: "X" }
   *   target: "getsentry/craft"  # string shorthand
   *
   * Legacy format:
   *   source: "ghcr.io/org/image"
   *   sourceRegistry: "ghcr.io"
   *   sourceUsernameVar: "X"
   */
  public getDockerConfig(): DockerTargetOptions {
    // Normalize source and target configs (handles string vs object, legacy vs new)
    const source = normalizeImageRef(this.config, 'source');
    const target = normalizeImageRef(this.config, 'target');

    // Resolve registries (explicit config > auto-detected from image)
    const targetRegistry = target.registry ?? extractRegistry(target.image);
    const sourceRegistry = source.registry ?? extractRegistry(source.image);

    // Resolve target credentials
    // - Skip if skipLogin is set (auth configured externally)
    // - For Google Cloud registries, credentials are optional (can use gcloud auth)
    // - For other registries, credentials are required
    let targetCredentials: RegistryCredentials | undefined;
    if (!target.skipLogin) {
      const isGcrTarget = isGoogleCloudRegistry(targetRegistry);
      targetCredentials = this.resolveCredentials(
        targetRegistry,
        target.usernameVar,
        target.passwordVar,
        // Required unless it's a GCR registry (which can use gcloud auth)
        !isGcrTarget
      );
    }

    // Resolve source credentials if source registry differs from target
    // Source credentials are optional - if not found, we assume the source is public
    // We don't fall back to default DOCKER_* credentials for source (those are for target)
    let sourceCredentials: RegistryCredentials | undefined;
    if (!source.skipLogin && sourceRegistry !== targetRegistry) {
      sourceCredentials = this.resolveCredentials(
        sourceRegistry,
        source.usernameVar,
        source.passwordVar,
        // Only required if explicit source env vars are specified
        !!(source.usernameVar || source.passwordVar),
        // Don't fall back to DOCKER_USERNAME/PASSWORD for source
        false
      );
    }

    return {
      source: {
        ...source,
        format: source.format || '{{{source}}}:{{{revision}}}',
        credentials: sourceCredentials,
      },
      target: {
        ...target,
        format: target.format || '{{{target}}}:{{{version}}}',
        credentials: targetCredentials,
      },
    };
  }

  /**
   * Logs into a Docker registry with the provided credentials.
   *
   * NOTE: This may change the globally logged in Docker user on the system
   *
   * @param credentials The registry credentials to use
   */
  private async loginToRegistry(credentials: RegistryCredentials): Promise<void> {
    const { username, password, registry } = credentials;
    const args = ['login', `--username=${username}`, '--password-stdin'];
    if (registry) {
      args.push(registry);
    }
    const registryName = registry || 'Docker Hub';
    this.logger.debug(`Logging into ${registryName}...`);
    // Pass password via stdin for security (avoids exposure in ps/process list)
    await spawnProcess(DOCKER_BIN, args, {}, { stdin: password });
  }

  /**
   * Configures Docker to use gcloud for authentication to Google Cloud registries.
   * This runs `gcloud auth configure-docker` which sets up the credential helper.
   *
   * @param registries List of Google Cloud registries to configure
   * @returns true if configuration was successful, false otherwise
   */
  private async configureGcloudDocker(registries: string[]): Promise<boolean> {
    if (registries.length === 0) {
      return false;
    }

    // Check if gcloud credentials are available
    if (!hasGcloudCredentials()) {
      this.logger.debug('No gcloud credentials detected, skipping gcloud auth configure-docker');
      return false;
    }

    // Check if gcloud is available
    if (!(await isGcloudAvailable())) {
      this.logger.debug('gcloud CLI not available, skipping gcloud auth configure-docker');
      return false;
    }

    const registryList = registries.join(',');
    this.logger.debug(`Configuring Docker for Google Cloud registries: ${registryList}`);

    try {
      // Run gcloud auth configure-docker with the registries
      // This configures Docker's credential helper to use gcloud for these registries
      await spawnProcess('gcloud', ['auth', 'configure-docker', registryList, '--quiet'], {}, {});
      this.logger.info(`Configured Docker authentication for: ${registryList}`);
      return true;
    } catch (error) {
      this.logger.warn(`Failed to configure gcloud Docker auth: ${error}`);
      return false;
    }
  }

  /**
   * Logs into all required Docker registries (source and target).
   *
   * For Google Cloud registries (gcr.io, *.pkg.dev), automatically uses
   * `gcloud auth configure-docker` if gcloud credentials are available.
   *
   * If the source registry differs from target and has credentials configured,
   * logs into both. Otherwise, only logs into the target registry.
   */
  public async login(): Promise<void> {
    const { source, target } = this.dockerConfig;

    // Resolve registries from the config
    const sourceRegistry = source.registry ?? extractRegistry(source.image);
    const targetRegistry = target.registry ?? extractRegistry(target.image);

    // Collect Google Cloud registries that need authentication
    const gcrRegistries: string[] = [];
    const gcrConfiguredRegistries = new Set<string>();

    // Check if source registry is a Google Cloud registry and needs auth
    if (
      !source.skipLogin &&
      !source.credentials &&
      sourceRegistry &&
      isGoogleCloudRegistry(sourceRegistry)
    ) {
      gcrRegistries.push(sourceRegistry);
    }

    // Check if target registry is a Google Cloud registry and needs auth
    if (
      !target.skipLogin &&
      !target.credentials &&
      targetRegistry &&
      isGoogleCloudRegistry(targetRegistry)
    ) {
      // Avoid duplicates
      if (!gcrRegistries.includes(targetRegistry)) {
        gcrRegistries.push(targetRegistry);
      }
    }

    // Try to configure gcloud for Google Cloud registries
    if (gcrRegistries.length > 0) {
      const configured = await this.configureGcloudDocker(gcrRegistries);
      if (configured) {
        gcrRegistries.forEach(r => gcrConfiguredRegistries.add(r));
      }
    }

    // Login to source registry (if needed and not already configured via gcloud)
    if (source.credentials) {
      await this.loginToRegistry(source.credentials);
    } else if (
      sourceRegistry &&
      !source.skipLogin &&
      !gcrConfiguredRegistries.has(sourceRegistry)
    ) {
      // Source registry needs auth but we couldn't configure it
      // This is okay - source might be public or already authenticated
      this.logger.debug(`No credentials for source registry ${sourceRegistry}, assuming public`);
    }

    // Login to target registry (if needed and not already configured via gcloud)
    if (target.credentials) {
      await this.loginToRegistry(target.credentials);
    } else if (!target.skipLogin && !gcrConfiguredRegistries.has(targetRegistry || '')) {
      // Target registry needs auth but we have no credentials and couldn't configure gcloud
      // This will likely fail when pushing, but we let it proceed
      if (targetRegistry) {
        this.logger.warn(
          `No credentials for target registry ${targetRegistry}. Push may fail.`
        );
      }
    }
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
    const { source, target } = this.dockerConfig;

    const sourceImage = renderTemplateSafe(source.format, {
      source: source.image,
      target: target.image,
      revision: sourceRevision,
    });
    const targetImage = renderTemplateSafe(target.format, {
      source: source.image,
      target: target.image,
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
  public async publish(version: string, revision: string): Promise<void> {
    await this.login();
    await this.copy(revision, version);

    this.logger.info('Docker release complete');
  }
}
