import * as _ from 'lodash';
// tslint:disable-next-line:no-submodule-imports
import * as simpleGit from 'simple-git/promise';

import { getGlobalGithubConfig } from '../config';
import { logger as loggerRaw } from '../logger';
import { GithubGlobalConfig, TargetConfig } from '../schemas/project_config';
import { ZeusStore } from '../stores/zeus';
import { forEachChained } from '../utils/async';
import { ConfigurationError } from '../utils/errors';
import { withTempDir } from '../utils/files';
import { checkExecutableIsPresent, spawnProcess } from '../utils/system';
import { BaseTarget } from './base';

const logger = loggerRaw.withScope('[crates]');

const DEFAULT_CARGO_BIN = 'cargo';

/**
 * Command to launch cargo
 */
const CARGO_BIN = process.env.CARGO_BIN || DEFAULT_CARGO_BIN;

/** Options for "crates" target */
export interface CratesTargetOptions extends TargetConfig {
  /** Crates API token */
  apiToken: string;
}

/** A package dependency specification */
export interface CrateDependency {
  /** Unique name of the package */
  name: string;
  /** The required version range */
  req: string;
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

  public constructor(config: any, store: ZeusStore) {
    super(config, store);
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

    // We iterate until there are no packages left. Note that cargo will already
    // check for cycles in the dependency graph and fail if its not a DAG.
    while (!_.isEmpty(remaining)) {
      _.filter(
        remaining,
        // Find all packages with no remaining workspace dependencies
        p => p.dependencies.filter(dep => remaining[dep.name]).length === 0
      ).forEach(next => {
        ordered.push(next);
        delete remaining[next.name]; // tslint:disable-line:no-dynamic-delete
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
    const unorderedCrates = metadata.packages.filter(
      p => metadata.workspace_members.indexOf(p.id) > -1
    );

    const crates = this.getPublishOrder(unorderedCrates);
    logger.debug(
      `Publishing packages in the following order: [${crates.map(c => c.name)}]`
    );
    return forEachChained(crates, async crate => this.publishPackage(crate));
  }

  /**
   * Uploads an archive to Crates.io registry using "cargo"
   *
   * @param path Absolute path to the archive to upload
   * @returns A promise that resolves when the upload has completed
   */
  public async publishPackage(crate: CratePackage): Promise<any> {
    const args = [
      'publish',
      '--no-verify', // Verification should be done on the CI stage
      '--manifest-path',
      crate.manifest_path,
    ];
    return spawnProcess(CARGO_BIN, args, {
      env: { ...process.env, CARGO_REGISTRY_TOKEN: this.cratesConfig.apiToken },
    });
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
