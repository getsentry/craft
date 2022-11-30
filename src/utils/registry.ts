import { promises as fsPromises, existsSync } from 'fs';
import * as path from 'path';

import { logger } from '../logger';
import { createSymlinks } from './symlink';
import { reportError } from './errors';
import { GitHubRemote } from './githubApi';
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
 * @param type The type of the registry package.
 * @param canonical The app's canonical name.
 * @param version The package version.
 */
export async function getPackageManifest(
  baseDir: string,
  type: RegistryPackageType,
  canonicalName: string,
  version: string
): Promise<{ isInitial: boolean, versionFilePath: string; packageManifest: any }> {
  const packageDirPath = getPackageDirPath(type, canonicalName);
  const versionFilePath = path.join(baseDir, packageDirPath, `${version}.json`);
  if (existsSync(versionFilePath)) {
    reportError(`Version file for "${version}" already exists. Aborting.`);
  }

  // If there was no prior releases, we use `manifest.json` file as a template
  // and remove it after the initial release.
  const initialManifestPath = path.join(baseDir, packageDirPath, 'manifest.json');
  const packageManifestPath = path.join(baseDir, packageDirPath, 'latest.json');

  if (existsSync(initialManifestPath)) {
    logger.debug('Reading the initial configuration from', initialManifestPath);

    return {
      isInitial: true,
      versionFilePath,
      packageManifest: JSON.parse(await fsPromises.readFile(initialManifestPath, { encoding: 'utf-8' }))
    };
  }

  logger.debug('Reading the current configuration from', packageManifestPath);

  return {
    isInitial: false,
    versionFilePath,
    packageManifest: JSON.parse(await fsPromises.readFile(packageManifestPath, { encoding: 'utf-8' }))
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

export const DEFAULT_REGISTRY_REMOTE = new GitHubRemote(
  'getsentry',
  'sentry-release-registry'
);

/**
 * Remove the initial manifest.json from the package directory.
 *
 * @param baseDir Base directory for the registry clone
 * @param type The type of the registry package.
 * @param canonical The app's canonical name.
 */
 export async function removeInitialManifest(
  baseDir: string,
  type: RegistryPackageType,
  canonicalName: string
) {
  const packageDirPath = getPackageDirPath(type, canonicalName);
   const initialManifestPath = path.join(baseDir, packageDirPath, 'manifest.json');

  if (existsSync(initialManifestPath)) {
    logger.debug('Removing the initial configuration from', initialManifestPath);
    await fsPromises.unlink(initialManifestPath);
  }
}
