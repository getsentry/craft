import { join } from 'path';

import {
  GitHubGlobalConfig,
  TargetConfig,
  TypedTargetConfig,
} from '../schemas/project_config';
import { checkEnvForPrerequisite } from '../utils/env';
import { ConfigurationError, reportError } from '../utils/errors';
import { withTempDir } from '../utils/files';
import { isDryRun } from '../utils/helpers';
import { logDryRun } from '../utils/dryRun';
import {
  checkExecutableIsPresent,
  extractZipArchiveWithFlattening,
  resolveExecutable,
  spawnProcess,
} from '../utils/system';
import { BaseTarget } from './base';
import { BaseArtifactProvider } from '../artifact_providers/base';

/**
 * Secrets required to authenticate with the Cloudflare API.
 *
 * Only the API token is a true secret. The account ID is an identifier, not a
 * credential, and is handled separately (see `CLOUDFLARE_ACCOUNT_ID` below):
 * it is optional and, when set, forwarded to wrangler; otherwise wrangler
 * auto-discovers it for single-account tokens.
 *
 * Exported so tests (and documentation tooling) can reference the canonical
 * list of environment variables this target consumes.
 */
export const targetSecrets = ['CLOUDFLARE_API_TOKEN'] as const;
type SecretsType = (typeof targetSecrets)[number];

/**
 * Optional, non-secret account identifier forwarded to wrangler when present.
 * When unset, wrangler auto-discovers the account for single-account tokens.
 */
const ACCOUNT_ID_ENV_VAR = 'CLOUDFLARE_ACCOUNT_ID';

/** Base URL of the Cloudflare REST API. */
const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com/client/v4';

/**
 * Matches a string that is exactly an environment-variable expansion, e.g.
 * `${CLOUDFLARE_API_TOKEN}`. `spawnProcess` expands args of this exact form
 * against the environment (which includes the API token), so any value flowing
 * into wrangler argv must be rejected if it matches — whether it comes from
 * config or from the Cloudflare API.
 */
const ENV_EXPANSION_REGEX = /^\$\{.*\}$/;

/** Wrangler executable configuration */
const WRANGLER_CONFIG = {
  name: 'wrangler',
  envVar: 'WRANGLER_BIN',
  errorHint:
    'Install wrangler (npm install -g wrangler) or set WRANGLER_BIN to its path',
} as const;

/** How the artifact should be deployed to Cloudflare */
type CloudflareDeployType = 'pages' | 'worker';

/** Valid deploy types */
const DEPLOY_TYPES: readonly CloudflareDeployType[] = ['pages', 'worker'];

/**
 * Default deploy type when none is configured.
 *
 * Defaults to "worker": Cloudflare is steering new projects to Workers (with
 * static assets) and positioning Pages as legacy, so Workers is the
 * forward-looking default. Pages remains fully supported via `deployType: pages`.
 */
const DEFAULT_DEPLOY_TYPE: CloudflareDeployType = 'worker';

/**
 * Regex for the Cloudflare deploy archive.
 *
 * Matches e.g. `cloudflare.zip` or `my-site-cloudflare.zip`. Can be overridden
 * via the `includeNames` target option.
 */
const DEFAULT_DEPLOY_ARCHIVE_REGEX = /^(?:.+-)?cloudflare\.zip$/;

/** Fields on the cloudflare target config accessed at runtime */
interface CloudflareConfigFields extends Record<string, unknown> {
  deployType?: string;
  projectName?: string;
  productionBranch?: string;
  wranglerCliPath?: string;
  workingDir?: string;
}

/** Target options for "cloudflare" */
export interface CloudflareTargetConfig {
  /** How to deploy: "worker" (default) or "pages" */
  deployType: CloudflareDeployType;
  /** Cloudflare Pages project name (required for `deployType: pages`) */
  projectName?: string;
  /**
   * The Cloudflare Pages project's production branch name. Passed to
   * `wrangler pages deploy --branch`, which does an exact-string match against
   * the project's server-side production branch: a match deploys to
   * production, anything else silently deploys to *preview*. When omitted, the
   * target reads the project's production branch from the Cloudflare API so a
   * release always lands on production. This is the Cloudflare environment
   * selector, NOT craft's git release branch.
   */
  productionBranch?: string;
  /** Resolved path/name of the wrangler binary */
  wranglerCliPath: string;
  /** Subdirectory within the extracted artifact to deploy from */
  workingDir?: string;
  /**
   * Optional Cloudflare account ID (an identifier, not a secret). Forwarded to
   * wrangler when set; otherwise wrangler auto-discovers it for single-account
   * tokens.
   */
  accountId?: string;
}

/**
 * Full config for the "cloudflare" target, including secrets.
 */
export type CloudflareTargetFullConfig = CloudflareTargetConfig &
  Record<SecretsType, string>;

/**
 * Target responsible for deploying static assets or Workers to Cloudflare.
 *
 * Shells out to the `wrangler` CLI (the reference implementation of the
 * Cloudflare deploy protocols). Two deploy modes are supported via the
 * `deployType` option:
 *   - "worker" (default) → `wrangler deploy` (using a `wrangler.toml` in the
 *     artifact)
 *   - "pages"  → `wrangler pages deploy <dir> --project-name <name> ...`
 */
export class CloudflareTarget extends BaseTarget {
  /** Target name */
  public readonly name: string = 'cloudflare';
  /** Target options */
  public readonly cloudflareConfig: CloudflareTargetFullConfig;
  /** GitHub repo configuration */
  public readonly githubRepo: GitHubGlobalConfig;

  public constructor(
    config: TargetConfig,
    artifactProvider: BaseArtifactProvider,
    githubRepo: GitHubGlobalConfig,
  ) {
    super(config, artifactProvider, githubRepo);
    this.githubRepo = githubRepo;
    this.cloudflareConfig = this.getCloudflareConfig();
    checkExecutableIsPresent(this.cloudflareConfig.wranglerCliPath);
  }

  /**
   * Extracts, validates and returns the "cloudflare" target options.
   *
   * @returns the cloudflare config for this target.
   */
  public getCloudflareConfig(): CloudflareTargetFullConfig {
    const config = this.config as TypedTargetConfig<CloudflareConfigFields>;

    const deployType = (config.deployType ??
      DEFAULT_DEPLOY_TYPE) as CloudflareDeployType;
    if (!DEPLOY_TYPES.includes(deployType)) {
      throw new ConfigurationError(
        `[cloudflare] Invalid deployType "${config.deployType}": ` +
          `must be one of ${DEPLOY_TYPES.map(t => `"${t}"`).join(', ')}`,
      );
    }

    if (deployType === 'pages' && !config.projectName) {
      throw new ConfigurationError(
        '[cloudflare] "projectName" is required when deployType is "pages"',
      );
    }

    // These config values are passed to wrangler as command-line arguments.
    // spawnProcess() expands args of the exact form "${VAR}" using the
    // environment -- which includes CLOUDFLARE_API_TOKEN/ACCOUNT_ID. Reject
    // such values so a config string can never be expanded into a secret.
    for (const [key, value] of Object.entries({
      projectName: config.projectName,
      productionBranch: config.productionBranch,
      workingDir: config.workingDir,
    })) {
      if (typeof value === 'string' && ENV_EXPANSION_REGEX.test(value)) {
        throw new ConfigurationError(
          `[cloudflare] "${key}" must not be an environment-variable ` +
            `expansion (got "${value}")`,
        );
      }
    }

    const wranglerCliPath = config.wranglerCliPath
      ? config.wranglerCliPath
      : resolveExecutable(WRANGLER_CONFIG);

    return {
      deployType,
      projectName: config.projectName,
      // No default: when unset we infer the project's production branch from
      // the Cloudflare API at publish time (see resolveProductionBranch).
      productionBranch: config.productionBranch,
      wranglerCliPath,
      workingDir: config.workingDir,
      // Optional, non-secret identifier. Forwarded to wrangler when present.
      accountId: process.env[ACCOUNT_ID_ENV_VAR] || undefined,
      ...this.getTargetSecrets(),
    };
  }

  private getTargetSecrets(): Record<SecretsType, string> {
    return targetSecrets
      .map(name => {
        checkEnvForPrerequisite({ name });
        return {
          name,
          value: process.env[name] as string,
        };
      })
      .reduce(
        (prev, current) => ({
          ...prev,
          [current.name]: current.value,
        }),
        {},
      ) as Record<SecretsType, string>;
  }

  /**
   * Builds the wrangler argument list for the configured deploy type.
   *
   * @param deployDir The directory to deploy from
   * @param version The version being released
   * @param revision The git commit SHA being published
   * @param productionBranch The resolved Pages production branch, or undefined
   *   to let wrangler decide (a bare deploy from the non-git temp dir defaults
   *   to production)
   */
  private getWranglerArgs(
    deployDir: string,
    version: string,
    revision: string,
    productionBranch?: string,
  ): string[] {
    if (this.cloudflareConfig.deployType === 'worker') {
      // Worker deploys use the local wrangler.toml; run with cwd=deployDir.
      return ['deploy'];
    }

    // Pages deploy. `wrangler pages deploy --branch <X>` deploys to production
    // only when <X> exactly matches the project's server-side production
    // branch; any other value silently produces a *preview* deployment. We
    // therefore pass the resolved production branch (from config or the API)
    // so a release reliably lands on production. The commit-* flags attach
    // release provenance and stop wrangler from inferring (wrong) git state
    // from the temp directory. If we couldn't resolve the branch we omit
    // `--branch`: a bare deploy from the non-git temp dir defaults to
    // production anyway.
    const args = [
      'pages',
      'deploy',
      deployDir,
      '--project-name',
      this.cloudflareConfig.projectName as string,
    ];
    if (productionBranch) {
      args.push('--branch', productionBranch);
    }
    args.push(
      '--commit-hash',
      revision,
      '--commit-message',
      `Release ${version}`,
      '--commit-dirty',
      'false',
    );
    return args;
  }

  /**
   * Resolves the Pages production branch for a `pages` deploy.
   *
   * Uses the configured `productionBranch` when set. Otherwise, if the account
   * ID is known, reads the project's production branch from the Cloudflare API
   * (`GET /accounts/{id}/pages/projects/{name}`) — the same call wrangler makes
   * internally, so it needs no token scope beyond deploying. Returns undefined
   * if it can't be resolved (caller then omits `--branch`).
   */
  private async resolveProductionBranch(): Promise<string | undefined> {
    if (this.cloudflareConfig.productionBranch) {
      return this.cloudflareConfig.productionBranch;
    }

    const accountId = this.cloudflareConfig.accountId;
    const projectName = this.cloudflareConfig.projectName;
    if (!accountId || !projectName) {
      // Without an account ID we can't address the API. Let wrangler handle
      // it (bare deploy from the non-git temp dir defaults to production).
      this.logger.debug(
        'Cloudflare: production branch not configured and account ID ' +
          'unavailable; omitting --branch (wrangler defaults to production).',
      );
      return undefined;
    }

    const url =
      `${CLOUDFLARE_API_BASE}/accounts/${encodeURIComponent(accountId)}` +
      `/pages/projects/${encodeURIComponent(projectName)}`;

    let response: Response;
    let body: { result?: { production_branch?: string } };
    try {
      response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.cloudflareConfig.CLOUDFLARE_API_TOKEN}`,
        },
      });
      // A 404 means the account/project pair is wrong -- a real
      // misconfiguration that would otherwise be masked by the soft fallback.
      // Handle it after the try so reportError's throw is not swallowed here.
      if (response.status !== 404 && !response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      body =
        response.status === 404
          ? {}
          : ((await response.json()) as {
              result?: { production_branch?: string };
            });
    } catch (err) {
      // Transient/network/parse failure: warn and fall back (omitting --branch
      // still lands on production for a bare non-git deploy).
      this.logger.warn(
        `Cloudflare: failed to read the project's production branch ` +
          `(${err instanceof Error ? err.message : String(err)}); omitting ` +
          '--branch (wrangler defaults to production).',
      );
      return undefined;
    }

    if (response.status === 404) {
      // Fail loudly instead of deploying to the wrong place.
      reportError(
        `[cloudflare] Pages project "${projectName}" not found for the ` +
          'configured account. Check "projectName" and CLOUDFLARE_ACCOUNT_ID.',
      );
      return undefined;
    }

    const branch = body.result?.production_branch;
    if (branch && ENV_EXPANSION_REGEX.test(branch)) {
      // Defense-in-depth: never let an API-sourced value that looks like an
      // env expansion reach wrangler argv (spawnProcess would expand it
      // against the environment, which holds the API token).
      this.logger.warn(
        `Cloudflare: ignoring suspicious production branch "${branch}" ` +
          'from the API; omitting --branch (wrangler defaults to production).',
      );
      return undefined;
    }
    if (branch) {
      this.logger.debug(
        `Cloudflare: inferred production branch "${branch}" from the API.`,
      );
      return branch;
    }
    this.logger.warn(
      'Cloudflare: API response did not include a production branch; ' +
        'omitting --branch (wrangler defaults to production).',
    );
    return undefined;
  }

  /**
   * Deploys the release artifact to Cloudflare via wrangler.
   *
   * @param version New version to be released
   * @param revision Git commit SHA to be published
   */
  public async publish(version: string, revision: string): Promise<void> {
    this.logger.debug('Fetching artifact list...');
    const packageFiles = await this.getArtifactsForRevision(revision, {
      includeNames: DEFAULT_DEPLOY_ARCHIVE_REGEX,
    });
    if (!packageFiles.length) {
      reportError('Cannot deploy to Cloudflare: no artifacts found');
      return;
    } else if (packageFiles.length > 1) {
      reportError(
        `Not implemented: more than one Cloudflare archive found\nDetails: ${JSON.stringify(
          packageFiles,
        )}`,
      );
      return;
    }

    const archivePath = await this.artifactProvider.downloadArtifact(
      packageFiles[0],
    );

    await withTempDir(
      async directory => {
        this.logger.info(`Extracting "${archivePath}" to "${directory}"...`);
        await extractZipArchiveWithFlattening(archivePath, directory);

        const deployDir = this.cloudflareConfig.workingDir
          ? join(directory, this.cloudflareConfig.workingDir)
          : directory;

        // A Cloudflare deploy is a remote, irreversible operation with no local
        // isolation. Unlike git/fs operations, it must NEVER run in dry-run
        // mode -- including worktree mode, where spawnProcess would otherwise
        // execute the command for real. Guard explicitly here, before any
        // network calls (production-branch inference also hits the API).
        if (isDryRun()) {
          const args = this.getWranglerArgs(
            deployDir,
            version,
            revision,
            this.cloudflareConfig.productionBranch,
          );
          logDryRun(
            `${this.cloudflareConfig.wranglerCliPath} ${args.join(' ')}`,
          );
          return;
        }

        // For Pages, resolve the production branch (config or API) so the
        // deploy reliably lands on production instead of a silent preview.
        const productionBranch =
          this.cloudflareConfig.deployType === 'pages'
            ? await this.resolveProductionBranch()
            : undefined;

        const args = this.getWranglerArgs(
          deployDir,
          version,
          revision,
          productionBranch,
        );

        const env: NodeJS.ProcessEnv = {
          ...process.env,
          CLOUDFLARE_API_TOKEN: this.cloudflareConfig.CLOUDFLARE_API_TOKEN,
        };
        // Account ID is an optional identifier: forward it only when set,
        // otherwise let wrangler auto-discover it for single-account tokens.
        if (this.cloudflareConfig.accountId) {
          env.CLOUDFLARE_ACCOUNT_ID = this.cloudflareConfig.accountId;
        }

        this.logger.info(
          `Deploying to Cloudflare (${this.cloudflareConfig.deployType})...`,
        );
        await spawnProcess(
          this.cloudflareConfig.wranglerCliPath,
          args,
          { cwd: deployDir, env },
          { showStdout: true },
        );
      },
      true,
      'craft-cloudflare-',
    );

    this.logger.info('Cloudflare deploy complete');
  }
}
