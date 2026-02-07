import { promises as fsPromises, existsSync, mkdirSync } from 'fs';
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

/** Initial manifest data for creating new packages in the registry */
export interface InitialManifestData {
  /** The package's canonical name (e.g., "npm:@sentry/browser") */
  canonical: string;
  /** Link to GitHub repo */
  repoUrl: string;
  /** Human-readable name for the package */
  name?: string;
  /** Link to package registry (PyPI, npm, etc.) */
  packageUrl?: string;
  /** Link to main documentation */
  mainDocsUrl?: string;
  /** Link to API documentation */
  apiDocsUrl?: string;
}

/**
 * Creates an initial manifest for a new package in the registry.
 *
 * @param initialData Data for the initial manifest
 * @returns The initial package manifest object
 */
function createInitialManifest(initialData: InitialManifestData): {
  [key: string]: any;
} {
  const manifest: { [key: string]: any } = {
    canonical: initialData.canonical,
    repo_url: initialData.repoUrl,
  };

  if (initialData.name) {
    manifest.name = initialData.name;
  }
  if (initialData.packageUrl) {
    manifest.package_url = initialData.packageUrl;
  }
  if (initialData.mainDocsUrl) {
    manifest.main_docs_url = initialData.mainDocsUrl;
  }
  if (initialData.apiDocsUrl) {
    manifest.api_docs_url = initialData.apiDocsUrl;
  }

  return manifest;
}

/**
 * Gets the package manifest version in the given directory.
 * If the package doesn't exist yet, creates the directory structure and
 * returns an initial manifest.
 *
 * @param baseDir Base directory for the registry clone
 * @param type The type of the registry package (APP or SDK)
 * @param canonicalName The package's canonical name
 * @param version The package version
 * @param initialManifestData Optional data for creating initial manifest for new packages
 */
export async function getPackageManifest(
  baseDir: string,
  type: RegistryPackageType,
  canonicalName: string,
  version: string,
  initialManifestData?: InitialManifestData,
): Promise<{ versionFilePath: string; packageManifest: any }> {
  const packageDirPath = getPackageDirPath(type, canonicalName);
  const fullPackageDir = path.join(baseDir, packageDirPath);
  const versionFilePath = path.join(fullPackageDir, `${version}.json`);

  if (existsSync(versionFilePath)) {
    reportError(`Version file for "${version}" already exists. Aborting.`);
  }

  const packageManifestPath = path.join(fullPackageDir, 'latest.json');

  // Check if this is a new package (no latest.json exists)
  if (!existsSync(packageManifestPath)) {
    if (!initialManifestData) {
      reportError(
        `Package "${canonicalName}" does not exist in the registry and no initial manifest data was provided.`,
      );
      // reportError throws in non-dry-run mode, but TypeScript doesn't know that
      // This is unreachable in practice, but needed for type narrowing
      throw new Error('Unreachable');
    }

    // Create directory structure if it doesn't exist
    if (!existsSync(fullPackageDir)) {
      logger.info(
        `Creating new package directory for "${canonicalName}" at "${packageDirPath}"...`,
      );
      mkdirSync(fullPackageDir, { recursive: true });
    }

    logger.info(
      `Creating initial manifest for new package "${canonicalName}"...`,
    );
    return {
      versionFilePath,
      packageManifest: createInitialManifest(initialManifestData),
    };
  }

  logger.debug('Reading the current configuration from', packageManifestPath);
  return {
    versionFilePath,
    packageManifest:
      JSON.parse(
        await fsPromises.readFile(packageManifestPath, { encoding: 'utf-8' }),
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
  previousVersion: string,
): Promise<void> {
  const manifestString = JSON.stringify(updatedManifest, undefined, 2) + '\n';
  logger.trace('Updated manifest', manifestString);
  logger.debug(`Writing updated manifest to "${versionFilePath}"...`);
  await fsPromises.writeFile(versionFilePath, manifestString);
  createSymlinks(versionFilePath, version, previousVersion);
}

export const DEFAULT_REGISTRY_REMOTE = new GitHubRemote(
  'getsentry',
  'sentry-release-registry',
);
