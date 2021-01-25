import * as fs from 'fs';
import * as path from 'path';

import { logger } from '../logger';
import { createSymlinks } from './symlink';
import { reportError } from './errors';

/**
 * Gets the package manifest version in the given directory.
 *
 * @param packageDirPath The package directory.
 * @param version The package version.
 */
export async function getPackageManifest(
  packageDirPath: string,
  version: string
): Promise<any> {
  const versionFilePath = path.join(packageDirPath, `${version}.json`);
  if (fs.existsSync(versionFilePath)) {
    reportError(`Version file for "${version}" already exists. Aborting.`);
  }
  const packageManifestPath = path.join(packageDirPath, 'latest.json');
  logger.debug('Reading the current configuration from "latest.json"...');
  return JSON.parse(fs.readFileSync(packageManifestPath).toString()) || {};
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
export function updateManifestSymlinks(
  updatedManifest: any,
  version: string,
  versionFilePath: string,
  previousVersion: string
): void {
  const manifestString = JSON.stringify(updatedManifest, undefined, 2) + '\n';
  logger.debug('Updated manifest', manifestString);
  logger.debug(`Writing updated manifest to "${versionFilePath}"...`);
  fs.writeFileSync(versionFilePath, manifestString);
  createSymlinks(versionFilePath, version, previousVersion);
}
