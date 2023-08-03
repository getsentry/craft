import * as fs from 'fs';
import * as path from 'path';

import { logger } from '../logger';
import { ConfigurationError } from './errors';
import { parseVersion, versionGreaterOrEqualThan } from './version';

/**
 * Creates a symlink, overwriting the existing one
 *
 * @param target Target path
 * @param newFile Path to the new symlink
 */
function forceSymlink(target: string, newFile: string): void {
  if (fs.existsSync(newFile)) {
    fs.unlinkSync(newFile);
  }
  fs.symlinkSync(target, newFile);
}

/**
 * Create symbolic links to the new version file
 *
 * "latest.json" and "{major}.json" links are not updated if the new version is "older" (e.g., it's
 * a patch release for an older major version).
 *
 * @param versionFilePath Path to the new version file
 * @param newVersion The new version
 * @param oldVersion The previous latest version
 */
export function createSymlinks(
  versionFilePath: string,
  newVersion: string,
  oldVersion?: string
): void {
  const parsedNewVersion = parseVersion(newVersion) || undefined;
  if (!parsedNewVersion) {
    throw new ConfigurationError(`Cannot parse version: "${parsedNewVersion}"`);
  }
  const parsedOldVersion =
    (oldVersion ? parseVersion(oldVersion) : undefined) || undefined;
  const baseVersionName = path.basename(versionFilePath);
  const packageDir = path.dirname(versionFilePath);

  // link latest.json and {major}.json, but only if the new version is "newer"
  if (
    parsedOldVersion &&
    !versionGreaterOrEqualThan(parsedNewVersion, parsedOldVersion)
  ) {
    logger.warn(
      `Not updating the latest version file: current version is "${oldVersion}", new version is "${newVersion}"`
    );
    logger.warn(
      `Not updating the major version file: current version is "${oldVersion}", new version is "${newVersion}"`
    );
  } else {
    logger.debug(
      `Changing symlink for "latest.json" from version "${oldVersion}" to "${newVersion}"`
    );
    forceSymlink(baseVersionName, path.join(packageDir, 'latest.json'));


    logger.debug(
      `Changing symlink for "{major}.json" from version "${oldVersion}" to "${newVersion}"`
    );
    const majorVersionLink = `${parsedNewVersion.major}.json`;
    forceSymlink(baseVersionName, path.join(packageDir, majorVersionLink));
  }

  // link minor
  const minorVersionLink = `${parsedNewVersion.major}.${parsedNewVersion.minor}.json`;
  forceSymlink(baseVersionName, path.join(packageDir, minorVersionLink));
}
