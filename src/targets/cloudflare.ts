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
 * Exported so tests (and documentation tooling) can reference the canonical
 * list of environment variables this target consumes.
 */
export const targetSecrets = [
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_ACCOUNT_ID',
] as const;
type SecretsType = (typeof targetSecrets)[number];

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

/** Default deploy type when none is configured */
const DEFAULT_DEPLOY_TYPE: CloudflareDeployType = 'pages';

/** Default production branch passed to `wrangler pages deploy --branch` */
const DEFAULT_PRODUCTION_BRANCH = 'main';

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
  /** How to deploy: "pages" (default) or "worker" */
  deployType: CloudflareDeployType;
  /** Cloudflare Pages project name (required for `deployType: pages`) */
  projectName?: string;
  /**
   * The Cloudflare Pages project's production branch name. Passed to
   * `wrangler pages deploy --branch` so a release publish always targets the
   * production environment. This is the Cloudflare environment selector, NOT
   * craft's git release branch.
   */
  productionBranch: string;
  /** Resolved path/name of the wrangler binary */
  wranglerCliPath: string;
  /** Subdirectory within the extracted artifact to deploy from */
  workingDir?: string;
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
 *   - "pages"  → `wrangler pages deploy <dir> --project-name <name> ...`
 *   - "worker" → `wrangler deploy` (using a `wrangler.toml` in the artifact)
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
      if (typeof value === 'string' && /^\$\{.*\}$/.test(value)) {
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
      productionBranch: config.productionBranch || DEFAULT_PRODUCTION_BRANCH,
      wranglerCliPath,
      workingDir: config.workingDir,
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
   */
  private getWranglerArgs(
    deployDir: string,
    version: string,
    revision: string,
  ): string[] {
    if (this.cloudflareConfig.deployType === 'worker') {
      // Worker deploys use the local wrangler.toml; run with cwd=deployDir.
      return ['deploy'];
    }

    // Pages deploy. `--branch <productionBranch>` forces a production
    // deployment; the commit-* flags attach release provenance and prevent
    // wrangler from inferring (wrong) git state from the temp directory.
    return [
      'pages',
      'deploy',
      deployDir,
      '--project-name',
      this.cloudflareConfig.projectName as string,
      '--branch',
      this.cloudflareConfig.productionBranch,
      '--commit-hash',
      revision,
      '--commit-message',
      `Release ${version}`,
      '--commit-dirty',
      'false',
    ];
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

        const args = this.getWranglerArgs(deployDir, version, revision);

        // A Cloudflare deploy is a remote, irreversible operation with no local
        // isolation. Unlike git/fs operations, it must NEVER run in dry-run
        // mode -- including worktree mode, where spawnProcess would otherwise
        // execute the command for real. Guard explicitly here.
        if (isDryRun()) {
          logDryRun(
            `${this.cloudflareConfig.wranglerCliPath} ${args.join(' ')}`,
          );
          return;
        }

        const env = {
          ...process.env,
          CLOUDFLARE_API_TOKEN: this.cloudflareConfig.CLOUDFLARE_API_TOKEN,
          CLOUDFLARE_ACCOUNT_ID: this.cloudflareConfig.CLOUDFLARE_ACCOUNT_ID,
        };

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
