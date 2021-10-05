import { promises as fsPromises, existsSync } from 'fs';
import * as path from 'path';

import { logger } from '../logger';
import { createSymlinks } from './symlink';
import { reportError } from './errors';
import { GithubRemote } from './githubApi';
import { getPackageDirPath } from '../utils/packagePath';

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
 * @param version The package version.
 */
export async function getPackageManifest(
  baseDir: string,
  type: RegistryPackageType,
  canonicalName: string,
  version: string
): Promise<{ versionFilePath: string; packageManifest: any }> {
  const packageDirPath = getPackageDirPath(type, canonicalName);
  const versionFilePath = path.join(baseDir, packageDirPath, `${version}.json`);
  if (existsSync(versionFilePath)) {
    reportError(`Version file for "${version}" already exists. Aborting.`);
  }
  const packageManifestPath = path.join(baseDir, packageDirPath, 'latest.json');
  logger.debug('Reading the current configuration from', packageManifestPath);
  return {
    versionFilePath,
    packageManifest:
      JSON.parse(
        await fsPromises.readFile(packageManifestPath, { encoding: 'utf-8' })
      ) || {},
  };
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

export const DEFAULT_REGISTRY_REMOTE = new GithubRemote(
  'getsentry',
  'sentry-release-registry'
);
