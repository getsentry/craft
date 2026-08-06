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
  extractZipArchive,
  resolveExecutable,
  spawnProcess,
} from '../utils/system';
import { BaseTarget } from './base';
import { BaseArtifactProvider } from '../artifact_providers/base';

/**
 * Secrets required to authenticate with Vercel.
 *
 * Only the token is a true secret. The org and project IDs are identifiers, not
 * credentials, and are handled separately (see the `*_ID_ENV_VAR` constants
 * below): they are optional and, when set, forwarded to the Vercel CLI through
 * the environment.
 *
 * Exported so tests (and documentation tooling) can reference the canonical
 * list of environment variables this target consumes.
 */
export const targetSecrets = ['VERCEL_TOKEN'] as const;
type SecretsType = (typeof targetSecrets)[number];

/**
 * Optional, non-secret identifiers forwarded to the Vercel CLI when present.
 * They link the deployment to a specific org/project non-interactively, which
 * is what CI needs (there is no interactive `vercel link` step). When unset,
 * the CLI falls back to the `.vercel/project.json` inside the artifact.
 */
const ORG_ID_ENV_VAR = 'VERCEL_ORG_ID';
const PROJECT_ID_ENV_VAR = 'VERCEL_PROJECT_ID';

/** Vercel executable configuration */
const VERCEL_CONFIG = {
  name: 'vercel',
  envVar: 'VERCEL_BIN',
  errorHint:
    'Install the Vercel CLI (npm install -g vercel) or set VERCEL_BIN to its path',
} as const;

/**
 * Matches a string that is exactly an environment-variable expansion, e.g.
 * `${VERCEL_TOKEN}`. `spawnProcess` expands args of this exact form against the
 * environment (which includes the token), so any value flowing into the CLI
 * argv must be rejected if it matches.
 */
const ENV_EXPANSION_REGEX = /^\$\{.*\}$/;

/**
 * Regex for the Vercel deploy archive.
 *
 * Matches e.g. `vercel.zip` or `my-docs-vercel.zip`. Can be overridden via the
 * `includeNames` target option.
 */
const DEFAULT_DEPLOY_ARCHIVE_REGEX = /^(?:.+-)?vercel\.zip$/;

/** Fields on the vercel target config accessed at runtime */
interface VercelConfigFields extends Record<string, unknown> {
  prebuilt?: boolean;
  vercelCliPath?: string;
  workingDir?: string;
}

/** Target options for "vercel" */
export interface VercelTargetConfig {
  /**
   * Whether the artifact contains a prebuilt `.vercel/output` (the result of
   * `vercel build`). When true, the CLI is invoked with `--prebuilt` and skips
   * the remote build step. Defaults to true: the docs website is built in CI
   * and the release just promotes the prebuilt output to production.
   */
  prebuilt: boolean;
  /** Resolved path/name of the vercel binary */
  vercelCliPath: string;
  /** Subdirectory within the extracted artifact to deploy from */
  workingDir?: string;
  /**
   * Optional Vercel org ID (an identifier, not a secret). Forwarded to the CLI
   * through the environment when set.
   */
  orgId?: string;
  /**
   * Optional Vercel project ID (an identifier, not a secret). Forwarded to the
   * CLI through the environment when set.
   */
  projectId?: string;
}

/**
 * Full config for the "vercel" target, including secrets.
 */
export type VercelTargetFullConfig = VercelTargetConfig &
  Record<SecretsType, string>;

/**
 * Target responsible for deploying a prebuilt static site to Vercel.
 *
 * Shells out to the `vercel` CLI to promote a release artifact to production
 * (`vercel deploy --prod`). Intended for release-gated documentation sites: the
 * artifact is built in CI and this target only publishes it, keeping the docs
 * in sync with the released version.
 */
export class VercelTarget extends BaseTarget {
  /** Target name */
  public readonly name: string = 'vercel';
  /** Target options */
  public readonly vercelConfig: VercelTargetFullConfig;
  /** GitHub repo configuration */
  public readonly githubRepo: GitHubGlobalConfig;

  public constructor(
    config: TargetConfig,
    artifactProvider: BaseArtifactProvider,
    githubRepo: GitHubGlobalConfig,
  ) {
    super(config, artifactProvider, githubRepo);
    this.githubRepo = githubRepo;
    this.vercelConfig = this.getVercelConfig();
    checkExecutableIsPresent(this.vercelConfig.vercelCliPath);
  }

  /**
   * Extracts, validates and returns the "vercel" target options.
   *
   * @returns the vercel config for this target.
   */
  public getVercelConfig(): VercelTargetFullConfig {
    const config = this.config as TypedTargetConfig<VercelConfigFields>;

    // These config values are passed to the CLI as command-line arguments.
    // spawnProcess() expands args of the exact form "${VAR}" using the
    // environment -- which includes VERCEL_TOKEN. Reject such values so a
    // config string can never be expanded into a secret.
    if (
      typeof config.workingDir === 'string' &&
      ENV_EXPANSION_REGEX.test(config.workingDir)
    ) {
      throw new ConfigurationError(
        `[vercel] "workingDir" must not be an environment-variable ` +
          `expansion (got "${config.workingDir}")`,
      );
    }

    const vercelCliPath = config.vercelCliPath
      ? config.vercelCliPath
      : resolveExecutable(VERCEL_CONFIG);

    return {
      prebuilt: config.prebuilt ?? true,
      vercelCliPath,
      workingDir: config.workingDir,
      // Optional, non-secret identifiers. Forwarded to the CLI when present.
      orgId: process.env[ORG_ID_ENV_VAR] || undefined,
      projectId: process.env[PROJECT_ID_ENV_VAR] || undefined,
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
   * Builds the vercel CLI argument list for a production deploy.
   *
   * @param version The version being released
   */
  private getVercelArgs(version: string): string[] {
    // `--prod` promotes to production; `--yes` skips interactive prompts (CI).
    const args = ['deploy', '--prod', '--yes'];
    if (this.vercelConfig.prebuilt) {
      args.push('--prebuilt');
    }
    // Attach release provenance so the deployment is traceable to the version.
    args.push('--meta', `craftRelease=${version}`);
    return args;
  }

  /**
   * Deploys the release artifact to Vercel via the `vercel` CLI.
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
      reportError('Cannot deploy to Vercel: no artifacts found');
      return;
    } else if (packageFiles.length > 1) {
      reportError(
        `Not implemented: more than one Vercel archive found\nDetails: ${JSON.stringify(
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
        await extractZipArchive(archivePath, directory);

        const deployDir = this.vercelConfig.workingDir
          ? join(directory, this.vercelConfig.workingDir)
          : directory;

        const args = this.getVercelArgs(version);

        // A Vercel deploy is a remote, irreversible operation with no local
        // isolation. Unlike git/fs operations, it must NEVER run in dry-run
        // mode -- including worktree mode, where spawnProcess would otherwise
        // execute the command for real. Guard explicitly here.
        if (isDryRun()) {
          logDryRun(`${this.vercelConfig.vercelCliPath} ${args.join(' ')}`);
          return;
        }

        const env: NodeJS.ProcessEnv = {
          ...process.env,
          VERCEL_TOKEN: this.vercelConfig.VERCEL_TOKEN,
        };
        // Org/project IDs are optional identifiers that link the deploy
        // non-interactively: forward them only when set, otherwise let the CLI
        // fall back to the artifact's `.vercel/project.json`.
        if (this.vercelConfig.orgId) {
          env.VERCEL_ORG_ID = this.vercelConfig.orgId;
        }
        if (this.vercelConfig.projectId) {
          env.VERCEL_PROJECT_ID = this.vercelConfig.projectId;
        }

        this.logger.info('Deploying to Vercel...');
        await spawnProcess(
          this.vercelConfig.vercelCliPath,
          args,
          { cwd: deployDir, env },
          { showStdout: true },
        );
      },
      true,
      'craft-vercel-',
    );

    this.logger.info('Vercel deploy complete');
  }
}
