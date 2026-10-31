import { readFileSync } from 'fs';
import { resolve } from 'path';
import { isDeepStrictEqual } from 'util';

import { getConfigFileDir } from '../config';
import {
  GitHubGlobalConfig,
  TargetConfig,
  TypedTargetConfig,
} from '../schemas/project_config';
import { sleep } from '../utils/async';
import { logDryRun } from '../utils/dryRun';
import { ConfigurationError } from '../utils/errors';
import { isDryRun } from '../utils/helpers';
import { BaseTarget } from './base';
import { BaseArtifactProvider } from '../artifact_providers/base';

/** The official MCP Registry */
export const DEFAULT_REGISTRY_URL = 'https://registry.modelcontextprotocol.io';

const DEFAULT_MANIFEST = 'server.json';

/**
 * Optional GitHub token, used when GitHub Actions OIDC is not available. Same
 * name `mcp-publisher` reads.
 */
export const GITHUB_TOKEN_ENV_VAR = 'MCP_GITHUB_TOKEN';

/** `_meta` key that holds the registry's own data about a listing */
const OFFICIAL_META_KEY = 'io.modelcontextprotocol.registry/official';

const REQUEST_TIMEOUT_MS = 30_000;

/** Bounded wait for a fresh listing to become readable after publishing */
const LISTING_ATTEMPTS = 6;
const LISTING_RETRY_DELAY_MS = 5_000;

/** The subset of `server.json` this target reads or rewrites */
interface ServerManifest extends Record<string, unknown> {
  name: string;
  version?: string;
  packages?: ServerPackage[];
}

interface ServerPackage extends Record<string, unknown> {
  version?: string;
}

interface RegistryListing {
  server?: Record<string, unknown>;
  _meta?: Record<string, { status?: string } | undefined>;
}

/** Fields on the mcp-registry target config accessed at runtime */
interface McpRegistryConfigFields extends Record<string, unknown> {
  manifest?: string;
  registryUrl?: string;
}

/** Target options for "mcp-registry" */
export interface McpRegistryTargetConfig {
  /** Absolute path to the `server.json` manifest */
  manifestPath: string;
  /** Registry base URL, without a trailing slash */
  registryUrl: string;
}

/**
 * Target that publishes an MCP server's `server.json` to the MCP Registry.
 *
 * It talks to the registry's HTTP API directly (the same endpoints
 * `mcp-publisher` uses), so no binary is downloaded. Registry versions are
 * immutable: a version that is already listed and matches the manifest is
 * skipped, and one that differs is an error.
 *
 * The registry checks each package itself when publishing (for npm: that the
 * version exists and its `mcpName` matches the server name) and returns a
 * descriptive error, so this target does not duplicate those checks.
 */
export class McpRegistryTarget extends BaseTarget {
  /** Target name */
  public readonly name: string = 'mcp-registry';
  /** Target options */
  public readonly mcpRegistryConfig: McpRegistryTargetConfig;

  public constructor(
    config: TargetConfig,
    artifactProvider: BaseArtifactProvider,
    githubRepo?: GitHubGlobalConfig,
  ) {
    super(config, artifactProvider, githubRepo);
    this.mcpRegistryConfig = this.getMcpRegistryConfig();
  }

  /**
   * Extracts, validates and returns the "mcp-registry" target options.
   */
  public getMcpRegistryConfig(): McpRegistryTargetConfig {
    const config = this.config as TypedTargetConfig<McpRegistryConfigFields>;

    const registryUrl = config.registryUrl ?? DEFAULT_REGISTRY_URL;
    let parsed: URL;
    try {
      parsed = new URL(registryUrl);
    } catch {
      throw new ConfigurationError(
        `[mcp-registry] Invalid registryUrl "${registryUrl}"`,
      );
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new ConfigurationError(
        `[mcp-registry] registryUrl must be an http(s) URL (got "${registryUrl}")`,
      );
    }

    // Like other repository paths in .craft.yml, the manifest path is
    // relative to the repository root, also inside a workspace.
    const root = getConfigFileDir() || process.cwd();
    return {
      manifestPath: resolve(root, config.manifest ?? DEFAULT_MANIFEST),
      registryUrl: registryUrl.replace(/\/+$/, ''),
    };
  }

  /**
   * Publishes the manifest at `version`, or verifies the existing listing.
   *
   * @param version New version to be released
   * @param _revision Git commit SHA to be published
   */
  public async publish(version: string, _revision: string): Promise<void> {
    const manifest = this.loadManifest(version);
    const label = `${manifest.name}@${version}`;

    const existing = await this.getListing(manifest.name, version);
    if (existing) {
      this.verifyListing(
        existing,
        manifest,
        `The MCP Registry already lists ${label}, but the listing differs ` +
          `from ${this.mcpRegistryConfig.manifestPath}. Registry versions ` +
          'are immutable, so release a new version instead.',
      );
      this.logger.info(`${label} is already listed in the MCP Registry`);
      return;
    }

    if (isDryRun()) {
      logDryRun(`publish ${label} to ${this.mcpRegistryConfig.registryUrl}`);
      return;
    }

    const token = await this.getRegistryToken();
    this.logger.info(`Publishing ${label} to the MCP Registry...`);
    await this.publishManifest(manifest, token);

    const listing = await this.waitForListing(manifest.name, version);
    this.verifyListing(
      listing,
      manifest,
      `The MCP Registry listing for ${label} does not match the published manifest.`,
    );
    this.logger.info(`Published ${label} to the MCP Registry`);
  }

  /**
   * Reads the manifest and sets `version` and every `packages[].version` to
   * the release version. The file on disk is not changed.
   */
  private loadManifest(version: string): ServerManifest {
    const { manifestPath } = this.mcpRegistryConfig;
    let manifest: ServerManifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    } catch (err) {
      throw new ConfigurationError(
        `[mcp-registry] Cannot read manifest ${manifestPath}: ${errorMessage(err)}`,
      );
    }
    if (typeof manifest?.name !== 'string' || !manifest.name) {
      throw new ConfigurationError(
        `[mcp-registry] Manifest ${manifestPath} has no "name"`,
      );
    }
    manifest.version = version;
    for (const pkg of manifest.packages ?? []) {
      pkg.version = version;
    }
    return manifest;
  }

  private listingUrl(name: string, version: string): string {
    return (
      `${this.mcpRegistryConfig.registryUrl}/v0.1/servers/` +
      `${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}`
    );
  }

  /**
   * Returns the registry listing for `name@version`, or undefined when that
   * version is not listed.
   */
  private async getListing(
    name: string,
    version: string,
  ): Promise<RegistryListing | undefined> {
    const response = await fetch(this.listingUrl(name, version), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.status === 404) {
      return undefined;
    }
    if (!response.ok) {
      throw new Error(
        `MCP Registry lookup for ${name}@${version} failed: HTTP ${response.status}`,
      );
    }
    return (await response.json()) as RegistryListing;
  }

  private async waitForListing(
    name: string,
    version: string,
  ): Promise<RegistryListing> {
    const listing = await this.pollJson(
      this.listingUrl(name, version),
      `MCP Registry listing for ${name}@${version}`,
      LISTING_ATTEMPTS,
      LISTING_RETRY_DELAY_MS,
    );
    if (!listing) {
      throw new Error(
        `Published ${name}@${version}, but the MCP Registry does not list it`,
      );
    }
    return listing as RegistryListing;
  }

  /**
   * Checks that the listing equals the manifest (ignoring `$schema`) and is
   * active. Throws `mismatchMessage` when the content differs.
   */
  private verifyListing(
    listing: RegistryListing,
    manifest: ServerManifest,
    mismatchMessage: string,
  ): void {
    if (
      !isDeepStrictEqual(
        withoutSchema(listing.server ?? {}),
        withoutSchema(manifest),
      )
    ) {
      throw new Error(mismatchMessage);
    }
    const status = listing._meta?.[OFFICIAL_META_KEY]?.status;
    if (status !== 'active') {
      throw new Error(
        `MCP Registry listing for ${manifest.name}@${manifest.version} has ` +
          `status "${status ?? 'unknown'}", expected "active"`,
      );
    }
  }

  /**
   * GETs `url` until it returns JSON. Retries 404, 5xx and network errors up
   * to `attempts` times and returns undefined if they never resolve. Other
   * HTTP errors throw immediately.
   */
  private async pollJson(
    url: string,
    label: string,
    attempts: number,
    delayMs: number,
  ): Promise<unknown> {
    for (let attempt = 1; ; attempt++) {
      let reason: string;
      let response: Response | undefined;
      try {
        response = await fetch(url, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        reason = `HTTP ${response.status}`;
      } catch (err) {
        reason = errorMessage(err);
      }
      if (response?.ok) {
        return response.json();
      }
      if (response && response.status !== 404 && response.status < 500) {
        throw new Error(`Fetching ${label} failed: ${reason}`);
      }
      if (attempt >= attempts) {
        return undefined;
      }
      this.logger.info(
        `${label} is not available yet (${reason}), retrying in ` +
          `${delayMs / 1000}s (${attempt}/${attempts})`,
      );
      await sleep(delayMs);
    }
  }

  /**
   * Gets a registry token. Uses GitHub Actions OIDC when the job has
   * `id-token: write`, otherwise exchanges `MCP_GITHUB_TOKEN`.
   */
  private async getRegistryToken(): Promise<string> {
    const requestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
    const requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
    if (requestUrl && requestToken) {
      this.logger.debug('Authenticating with GitHub Actions OIDC');
      const oidcToken = await this.getGitHubOidcToken(requestUrl, requestToken);
      return this.exchangeToken('github-oidc', { oidc_token: oidcToken });
    }

    const githubToken = process.env[GITHUB_TOKEN_ENV_VAR];
    if (githubToken) {
      this.logger.debug(`Authenticating with ${GITHUB_TOKEN_ENV_VAR}`);
      return this.exchangeToken('github-at', { github_token: githubToken });
    }

    throw new ConfigurationError(
      '[mcp-registry] No credentials: run in GitHub Actions with ' +
        `"id-token: write" permission, or set ${GITHUB_TOKEN_ENV_VAR}`,
    );
  }

  /**
   * Requests a GitHub Actions OIDC token. Its audience is the registry origin,
   * which the registry checks (same as `mcp-publisher login github-oidc`).
   */
  private async getGitHubOidcToken(
    requestUrl: string,
    requestToken: string,
  ): Promise<string> {
    const url = new URL(requestUrl);
    url.searchParams.set(
      'audience',
      new URL(this.mcpRegistryConfig.registryUrl).origin,
    );
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${requestToken}`,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(
        `GitHub OIDC token request failed: HTTP ${response.status}`,
      );
    }
    const { value } = (await response.json()) as { value?: string };
    if (!value) {
      throw new Error('GitHub OIDC token response has no token');
    }
    return value;
  }

  /** Exchanges a GitHub credential for a short-lived registry token */
  private async exchangeToken(
    method: 'github-oidc' | 'github-at',
    body: Record<string, string>,
  ): Promise<string> {
    const response = await this.postJson(
      `/v0/auth/${method}`,
      body,
      `${method} token exchange`,
    );
    const { registry_token: token } = (await response.json()) as {
      registry_token?: string;
    };
    if (!token) {
      throw new Error(
        `MCP Registry ${method} token exchange returned no token`,
      );
    }
    return token;
  }

  private async publishManifest(
    manifest: ServerManifest,
    token: string,
  ): Promise<void> {
    await this.postJson('/v0/publish', manifest, 'publish', token);
  }

  /** POSTs JSON to the registry and throws on a non-2xx response */
  private async postJson(
    path: string,
    body: unknown,
    action: string,
    token?: string,
  ): Promise<Response> {
    const response = await fetch(
      `${this.mcpRegistryConfig.registryUrl}${path}`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    if (!response.ok) {
      throw new Error(
        `MCP Registry ${action} failed: HTTP ${response.status}: ` +
          (await response.text()),
      );
    }
    return response;
  }
}

function withoutSchema(
  server: Record<string, unknown>,
): Record<string, unknown> {
  const copy = { ...server };
  delete copy.$schema;
  return copy;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
