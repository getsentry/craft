import { promises as fsPromises, existsSync } from 'fs';
import * as path from 'path';

import { logger } from '../logger';
import { createSymlinks } from './symlink';
import { reportError } from './errors';
import { getFile, GitHubRemote } from './githubApi';
import { GitHubGlobalConfig } from 'src/schemas/project_config';
import { Octokit } from '@octokit/rest';

/** Type of the registry package */
export enum RegistryPackageType {
  /** App is a generic package type that doesn't belong to any specific registry */
  APP = 'app',
  /** SDK is a package hosted in one of public registries (PyPI, NPM, etc.) */
  SDK = 'sdk',
}

/**
 * Gets the package manifest version in the given directory.
 *
 * @param baseDir Base directory for the registry clone
 * @param packageDirPath The package directory.
 * @param versionFilePath The package manifest for version to be released.
 * @param version The package version.
 */
export async function getPackageManifest(
  packageDirPath: string,
  versionFilePath: string,
  version: string
) {
  if (existsSync(versionFilePath)) {
    reportError(`Version file for "${version}" already exists. Aborting.`);
  }
  const packageManifestPath = path.join(packageDirPath, 'latest.json');
  logger.debug('Reading the current configuration from', packageManifestPath);

  try {
    return JSON.parse(
      await fsPromises.readFile(packageManifestPath, { encoding: 'utf-8' })
    )
  } catch (e) {
    reportError(`Cannot read configuration file ${e}}`);
  }
}

/**
 * Gets the initial package manifest from configured path.
 */
export async function getInitialPackageManifest(manifestTemplate: string, githubRepo: GitHubGlobalConfig, github: Octokit, revision: string) {
  const { owner, repo } = githubRepo;

  logger.info(`Loading manifest template from ${owner}/${repo}:${manifestTemplate}`);
  const manifestContents = await getFile(
    github,
    owner,
    repo,
    manifestTemplate,
    revision
  );

  if (!manifestContents) {
    reportError(`Manifest template not found at ${owner}/${repo}:${manifestTemplate}`);
  }

  return manifestContents;
}

/**
 * Updates the manifest to the version in the path and creates the symlinks to
 * the new version.
 *
 * @param updatedManifest The updated manifest.
 * @param version The new version to be updated.
 * @param versionFilePath The path of the version file.
 * @param previousVersion The previous version.
 */
export async function updateManifestSymlinks(
  updatedManifest: unknown,
  version: string,
  versionFilePath: string,
  previousVersion: string
): Promise<void> {
  const manifestString = JSON.stringify(updatedManifest, undefined, 2) + '\n';
  logger.trace('Updated manifest', manifestString);
  logger.debug(`Writing updated manifest to "${versionFilePath}"...`);
  await fsPromises.writeFile(versionFilePath, manifestString);
  createSymlinks(versionFilePath, version, previousVersion);
}

export const DEFAULT_REGISTRY_REMOTE = new GitHubRemote(
  'getsentry',
  'sentry-release-registry'
);
