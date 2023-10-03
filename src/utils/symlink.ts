import * as fs from 'fs';
import * as path from 'path';

import { logger } from '../logger';
import { ConfigurationError } from './errors';
import {
  SemVer,
  parseVersion,
  semVerToString,
  versionGreaterOrEqualThan,
} from './version';

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
 * "latest.json", "{major}.json" and "{minor}.json" links are respectively not
 * updated if the new version is "older" (e.g., it's a patch release for an
 * older major version) than the currently linked versions.
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

  if (
    !parsedOldVersion ||
    versionGreaterOrEqualThan(parsedNewVersion, parsedOldVersion)
  ) {
    logger.debug('Symlink "latest.json"', {
      before: oldVersion,
      after: newVersion,
    });
    forceSymlink(baseVersionName, path.join(packageDir, 'latest.json'));
  }

  // Read possibly existing symlinks for major and minor versions of the new version
  const existingLinkedMajorVersion = getExistingSymlinkedVersion(
    path.join(packageDir, `${parsedNewVersion.major}.json`)
  );
  const existingLinkedMinorVersion = getExistingSymlinkedVersion(
    path.join(
      packageDir,
      `${parsedNewVersion.major}.${parsedNewVersion.minor}.json`
    )
  );

  // link {major}.json if there's no link yet for that major
  // or if the new version is newer than the currently linked one
  if (
    !existingLinkedMajorVersion ||
    versionGreaterOrEqualThan(parsedNewVersion, existingLinkedMajorVersion)
  ) {
    const majorVersionLink = `${parsedNewVersion.major}.json`;
    logger.debug(`Symlink "${majorVersionLink}"`, {
      before:
        existingLinkedMajorVersion &&
        semVerToString(existingLinkedMajorVersion),
      after: newVersion,
    });
    forceSymlink(baseVersionName, path.join(packageDir, majorVersionLink));
  }

  // link {minor}.json if there's no link yet for that minor
  // or if the new version is newer than the currently linked one
  if (
    !existingLinkedMinorVersion ||
    versionGreaterOrEqualThan(parsedNewVersion, existingLinkedMinorVersion)
  ) {
    const minorVersionLink = `${parsedNewVersion.major}.${parsedNewVersion.minor}.json`;
    logger.debug(`Symlink "${minorVersionLink}"`, {
      before:
        existingLinkedMinorVersion &&
        semVerToString(existingLinkedMinorVersion),
      after: newVersion,
    });
    forceSymlink(baseVersionName, path.join(packageDir, minorVersionLink));
  }
}

function getExistingSymlinkedVersion(symlinkPath: string): SemVer | null {
  try {
    // using lstat instead of exists because broken symlinks return false for exists
    fs.lstatSync(symlinkPath);
  } catch {
    // this means the symlink doesn't exist
    return null;
  }
  const linkedFile = fs.readlinkSync(symlinkPath);
  return parseVersion(path.basename(linkedFile));
}
