import * as fs from 'fs';
import * as path from 'path';

import * as _ from 'lodash';
import * as simpleGit from 'simple-git/promise';

import { getGlobalGithubConfig } from '../config';
import { logger as loggerRaw } from '../logger';
import { GithubGlobalConfig, TargetConfig } from '../schemas/project_config';
import { forEachChained } from '../utils/async';
import { ConfigurationError } from '../utils/errors';
import { withTempDir } from '../utils/files';
import {
  checkExecutableIsPresent,
  sleepAsync,
  spawnProcess,
} from '../utils/system';
import { BaseTarget } from './base';
import { BaseArtifactProvider } from '../artifact_providers/base';

const logger = loggerRaw.withScope('[crates]');

const DEFAULT_CARGO_BIN = 'cargo';

/**
 * Command to launch cargo
 */
const CARGO_BIN = process.env.CARGO_BIN || DEFAULT_CARGO_BIN;

/**
 * A message fragment emitted by cargo when publishing fails due to a missing
 * dependency. This sometimes indicates a false positive if the cache has not
 * been updated.
 */
const VERSION_ERROR = 'failed to select a version for the requirement';

/**
 * Maximum number of attempts including the initial one when publishing fails
 * due to a stale cache. After this number of retries, publishing fails.
 */
const MAX_ATTEMPTS = 5;

/**
 * Initial delay to wait between publish retries in seconds. Exponential backoff
 * is applied to this delay on retries.
 */
const RETRY_DELAY_SECS = 2;

/**
 * Exponential backoff that is applied to the initial retry delay.
 */
const RETRY_EXP_FACTOR = 2;

/** Options for "crates" target */
export interface CratesTargetOptions {
  /** Crates API token */
  apiToken: string;
  /** Whether to use `cargo-hack` and remove dev dependencies */
  noDevDeps: boolean;
}

/** A package dependency specification */
export interface CrateDependency {
  /** Unique name of the package */
  name: string;
  /** The required version range */
  req: string;
  /** The dependency kind. "dev", "build", or null for a normal dependency. */
  kind: string | null;
}

/** A crate (Rust) package */
export interface CratePackage {
  /** Unique identifier containing name, version and location */
  id: string;
  /** The unique name of the crate package */
  name: string;
  /** The current version of this package */
  version: string;
  /** Path to the manifest in the local workspace */
  manifest_path: string;
  /** The full list of package dependencies */
  dependencies: CrateDependency[];
  /**
   * A list of registry names allowed for publishing.
   *
   * By default, this value is `null`. If this value is an empty array, then
   * publishing for this crate is disabled (`publish = false` in TOML).
   */
  publish: string[] | null;
}

/** Metadata on a crate workspace */
export interface CrateMetadata {
  /** The full list of packages in this workspace */
  packages: CratePackage[];
  /** IDs of the packages in this workspace */
  workspace_members: string[];
}

/**
 * Target responsible for publishing releases on Crates.io (Rust packages)
 */
export class CratesTarget extends BaseTarget {
  /** Target name */
  public readonly name: string = 'crates';
  /** Target options */
  public readonly cratesConfig: CratesTargetOptions;

  public constructor(
    config: TargetConfig,
    artifactProvider: BaseArtifactProvider
  ) {
    super(config, artifactProvider);
    this.cratesConfig = this.getCratesConfig();
    checkExecutableIsPresent(CARGO_BIN);
  }

  /**
   * Extracts Crates target options from the environment
   */
  public getCratesConfig(): CratesTargetOptions {
    if (!process.env.CRATES_IO_TOKEN) {
      throw new ConfigurationError(
        `Cannot publish to Crates.io: missing credentials.
         Please use CRATES_IO_TOKEN environment variable to pass the API token.`
      );
    }
    return {
      apiToken: process.env.CRATES_IO_TOKEN,
      noDevDeps: !!this.config.noDevDeps,
    };
  }

  /**
   * Resolves crate metadata for the project located in the specified directory
   *
   * Crate metadata comprises the name and version of the root package, as well as
   * a flat list of its local dependencies and their respective versions. The full
   * list of dependencies is not included in this metadata.
   *
   * @param directory Path to the root crate / package
   * @returns An object containing cargo metadata
   * @async
   */
  public async getCrateMetadata(directory: string): Promise<CrateMetadata> {
    const args = [
      'metadata',
      '--manifest-path',
      `${directory}/Cargo.toml`,
      '--no-deps',
      '--format-version=1',
    ];

    logger.info(`Loading workspace information from ${directory}/Cargo.toml`);
    const metadata = await spawnProcess(
      CARGO_BIN,
      args,
      {},
      { enableInDryRunMode: true }
    );
    if (!metadata) {
      throw new ConfigurationError('Empty Cargo metadata!');
    }
    return JSON.parse(metadata.toString());
  }

  /**
   * Determines the topological order in which to publish crates
   *
   * The order is determined by the dependency graph. In order to publish a crate,
   * all its dependencies have to be available on the index first. Therefore, this
   * method performs a topological sort of the list of given packages.
   *
   * Note that the actual order of packages in the result is indeterministic.
   * However, the topological order will always be consistent.
   *
   * @param packages A list of cargo packages (i.e. crates)
   * @returns The sorted list of packages
   */
  public getPublishOrder(packages: CratePackage[]): CratePackage[] {
    const remaining = _.keyBy(packages, p => p.name);
    const ordered: CratePackage[] = [];

    const isWorkspaceDependency = (dep: CrateDependency) => {
      // Optionally exclude dev dependencies from dependency resolution. When
      // this flag is provided, these usually lead to circular dependencies.
      if (this.cratesConfig.noDevDeps && dep.kind === 'dev') {
        return false;
      }

      return !!remaining[dep.name];
    };

    // We iterate until there are no packages left. Note that cargo will already
    // check for cycles in the dependency graph and fail if its not a DAG.
    while (!_.isEmpty(remaining)) {
      const leafDependencies = _.filter(
        remaining,
        // Find all packages with no remaining workspace dependencies
        p => p.dependencies.filter(isWorkspaceDependency).length === 0
      );

      if (leafDependencies.length === 0) {
        throw new Error('Circular dependency detected!');
      }

      leafDependencies.forEach(next => {
        ordered.push(next);
        delete remaining[next.name];
      });
    }
    return ordered;
  }

  /**
   * Publishes an entire workspace on crates.io
   *
   * If the workspace contains multiple packages with dependencies, they are
   * published in topological order. This ensures that once a package has been
   * published, all its requirements are available on the index as well.
   *
   * @param directory The path to the root package
   * @returns A promise that resolves when the workspace has been published
   */
  public async publishWorkspace(directory: string): Promise<any> {
    const metadata = await this.getCrateMetadata(directory);
    const unorderedCrates = metadata.packages
      // only publish workspace members
      .filter(p => metadata.workspace_members.indexOf(p.id) > -1)
      // skip crates with `"publish": []`
      .filter(p => !p.publish || p.publish.length);

    const crates = this.getPublishOrder(unorderedCrates);
    logger.debug(
      `Publishing packages in the following order: ${crates
        .map(c => c.name)
        .join(', ')}`
    );
    return forEachChained(crates, async crate => this.publishPackage(crate));
  }

  /**
   * Uploads an archive to Crates.io registry using "cargo"
   *
   * @param crate The CratePackage object to publish
   * @returns A promise that resolves when the upload has completed
   */
  public async publishPackage(crate: CratePackage): Promise<any> {
    const args = this.cratesConfig.noDevDeps
      ? ['hack', 'publish', '--allow-dirty', '--no-dev-deps']
      : ['publish'];

    args.push(
      '--no-verify', // Verification should be done on the CI stage
      '--manifest-path',
      crate.manifest_path
    );

    const env = {
      ...process.env,
      CARGO_REGISTRY_TOKEN: this.cratesConfig.apiToken,
    };

    let delay = RETRY_DELAY_SECS;
    logger.info(`Publishing ${crate.name}`);
    for (let i = 0; i <= MAX_ATTEMPTS; i++) {
      try {
        return await spawnProcess(CARGO_BIN, args, { env });
      } catch (e) {
        if (i < MAX_ATTEMPTS && e.message.includes(VERSION_ERROR)) {
          logger.warn(`Publish failed, trying again in ${delay}s...`);
          await sleepAsync(delay * 1000);
          delay *= RETRY_EXP_FACTOR;
        } else {
          throw e;
        }
      }
    }
  }

  /**
   * Clones a repository and its submodules.
   *
   * @param config Git configuration specifying the repository to clone.
   * @param revision The commit SHA that should be checked out after the clone.
   * @param directory The directory to clone into.
   */
  public async cloneWithSubmodules(
    config: GithubGlobalConfig,
    revision: string,
    directory: string
  ): Promise<any> {
    const { owner, repo } = config;
    const git = simpleGit(directory).silent(true);
    const url = `https://github.com/${owner}/${repo}.git`;

    logger.info(`Cloning ${owner}/${repo} into ${directory}`);
    await git.clone(url, directory);
    await git.checkout(revision);

    logger.info(`Checking out submodules`);
    await git.submoduleUpdate(['--init']);

    // Cargo seems to run into problems if the crate resides within a git
    // checkout located in a memory file system on Mac (e.g. /tmp). This can be
    // avoided by signaling to cargo that this is not a git checkout.
    const gitdir = path.join(directory, '.git');
    fs.renameSync(gitdir, `${gitdir}.bak`);
  }

  /**
   * Uploads all files to Crates.io using Cargo
   *
   * Requires twine to be configured in the environment (either beforehand or
   * via enviroment).
   *
   * @param version New version to be released
   * @param revision Git commit SHA to be published
   */
  public async publish(_version: string, revision: string): Promise<any> {
    const githubConfig = getGlobalGithubConfig();
    await withTempDir(
      async directory => {
        await this.cloneWithSubmodules(githubConfig, revision, directory);
        await this.publishWorkspace(directory);
      },
      true,
      'craft-crates-'
    );

    logger.info('Crates release complete');
  }
}
