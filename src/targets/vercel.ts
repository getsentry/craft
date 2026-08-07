import { join } from 'path';

import { createDeployment } from '@vercel/client';

import {
  GitHubGlobalConfig,
  TargetConfig,
  TypedTargetConfig,
} from '../schemas/project_config';
import { checkEnvForPrerequisite } from '../utils/env';
import { reportError } from '../utils/errors';
import { withTempDir } from '../utils/files';
import { isDryRun } from '../utils/helpers';
import { logDryRun } from '../utils/dryRun';
import { extractZipArchive } from '../utils/system';
import { BaseTarget } from './base';
import { BaseArtifactProvider } from '../artifact_providers/base';

/**
 * Secrets required to authenticate with the Vercel API.
 *
 * Only the token is a true secret. The org/team and project IDs are
 * identifiers, not credentials, and are handled separately (see the
 * `*_ID_ENV_VAR` constants below): they are optional and, when set, forwarded
 * to the deploy call so it links to the right project non-interactively.
 *
 * Exported so tests (and documentation tooling) can reference the canonical
 * list of environment variables this target consumes.
 */
export const targetSecrets = ['VERCEL_TOKEN'] as const;
type SecretsType = (typeof targetSecrets)[number];

/**
 * Optional, non-secret identifiers forwarded to the Vercel API when present.
 * They link the deployment to a specific team/project non-interactively, which
 * is what CI needs. Without a project ID, the deployment name is derived from
 * the deploy directory, which would not reliably target the intended project.
 */
const ORG_ID_ENV_VAR = 'VERCEL_ORG_ID';
const PROJECT_ID_ENV_VAR = 'VERCEL_PROJECT_ID';

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
  workingDir?: string;
  projectId?: string;
}

/** Target options for "vercel" */
export interface VercelTargetConfig {
  /**
   * Whether the artifact contains a prebuilt `.vercel/output` (the result of
   * `vercel build`). When true, the deploy is created with `prebuilt` and skips
   * the remote build step. Defaults to true: the docs website is built in CI
   * and the release just promotes the prebuilt output to production.
   */
  prebuilt: boolean;
  /** Subdirectory within the extracted artifact to deploy from */
  workingDir?: string;
  /**
   * Optional Vercel org/team ID (an identifier, not a secret). Forwarded to the
   * deploy as `teamId` when set.
   */
  orgId?: string;
  /**
   * Optional Vercel project ID (an identifier, not a secret). Forwarded to the
   * deploy as the `project` identifier so the deployment links to the intended
   * project non-interactively.
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
 * Uses the Vercel deploy API (via `@vercel/client`) to promote a release
 * artifact to production. Intended for release-gated documentation sites: the
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
  }

  /**
   * Extracts, validates and returns the "vercel" target options.
   *
   * @returns the vercel config for this target.
   */
  public getVercelConfig(): VercelTargetFullConfig {
    const config = this.config as TypedTargetConfig<VercelConfigFields>;

    return {
      prebuilt: config.prebuilt ?? true,
      workingDir: config.workingDir,
      // Optional, non-secret identifiers. Forwarded to the deploy when present.
      orgId: process.env[ORG_ID_ENV_VAR] || undefined,
      // An environment variable overrides the target config so shared publish
      // infrastructure can select a project without changing the repository.
      projectId:
        process.env[PROJECT_ID_ENV_VAR] || config.projectId || undefined,
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
   * Runs a Vercel production deploy of `deployDir` and waits for it to finish.
   *
   * Drives the `@vercel/client` event stream to completion: resolves on the
   * `alias-assigned` event (the production promotion is done), falls back to
   * the `ready` deployment URL when the stream ends without an alias event, and
   * throws on the `error` event so a failed deploy fails the release.
   *
   * @param deployDir Directory to deploy from
   * @param version The version being released (attached as deploy provenance)
   * @returns the production deployment URL
   */
  private async deploy(deployDir: string, version: string): Promise<string> {
    let url: string | undefined;
    const deploymentOptions: Record<string, unknown> = {
      // `production` deploys to production; `release` ties the deployment
      // back to the released version for traceability.
      target: 'production',
      meta: { release: version },
    };
    if (this.vercelConfig.projectId) {
      // `project` (the project ID) overrides `name` and reliably links the
      // deployment to the configured project non-interactively.
      deploymentOptions.project = this.vercelConfig.projectId;
    }
    for await (const event of createDeployment(
      {
        token: this.vercelConfig.VERCEL_TOKEN,
        path: deployDir,
        prebuilt: this.vercelConfig.prebuilt,
        teamId: this.vercelConfig.orgId,
        skipAutoDetectionConfirmation: true,
      },
      deploymentOptions,
    )) {
      if (event.type === 'ready') {
        url = event.payload.url as string;
      }
      if (event.type === 'alias-assigned') {
        return url || (event.payload.url as string);
      }
      if (event.type === 'error') {
        throw event.payload;
      }
    }
    if (url) {
      // Production alias assignment is best-effort for some projects; if the
      // stream ended after `ready` we still return the URL.
      return url;
    }
    throw new Error('Vercel deploy finished without a ready deployment');
  }

  /**
   * Deploys the release artifact to Vercel via the Vercel deploy API.
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

        // A Vercel deploy is a remote, irreversible operation with no local
        // isolation. Unlike git/fs operations, it must NEVER run in dry-run
        // mode -- including worktree mode. Guard explicitly here, before any
        // network calls.
        if (isDryRun()) {
          logDryRun(`@vercel/client createDeployment (${deployDir})`);
          return;
        }

        this.logger.info('Deploying to Vercel...');
        const url = await this.deploy(deployDir, version);
        this.logger.info(`Vercel deploy live at https://${url}`);
      },
      true,
      'craft-vercel-',
    );

    this.logger.info('Vercel deploy complete');
  }
}
