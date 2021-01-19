import * as fs from 'fs';
import * as path from 'path';
import * as simpleGit from 'simple-git/promise';

import { logger } from '../logger';
import { createSymlinks } from './symlink';
import { getPackageDirPath } from './packagePath';
import { reportError } from './errors';
import { GithubRemote } from './githubApi';
import { isDryRun } from './helpers';
import { RegistryTarget } from 'src/targets/registry';

/**
 * Updates the local copy of the release registry.
 *
 * @param registry The registry to be added to git.
 * @param directory The directory with the checkout out registry.
 * @param canonical The package's canonical name.
 * @param version The new version.
 * @param revision Git commit SHA to be published.
 */
async function addVersionToRegistry(
  registry: RegistryTarget,
  directory: string,
  canonical: string,
  version: string,
  revision: string
): Promise<void> {
  logger.info(
    `Adding the version file to the registry for canonical name "${canonical}"...`
  );
  const packageDirPath = getPackageDirPath(directory, canonical);

  const versionFilePath = path.join(packageDirPath, `${version}.json`);
  if (fs.existsSync(versionFilePath)) {
    reportError(`Version file for "${version}" already exists. Aborting.`);
  }

  const packageManifestPath = path.join(packageDirPath, 'latest.json');
  logger.debug('Reading the current configuration from "latest.json"...');
  const packageManifest =
    JSON.parse(fs.readFileSync(packageManifestPath).toString()) || {};
  const previousVersion = packageManifest.version || undefined;

  const updatedManifest = await registry.getUpdatedManifest(
    packageManifest,
    canonical,
    version,
    revision
  );

  const manifestString = JSON.stringify(updatedManifest, undefined, 2) + '\n';
  logger.debug('Updated manifest', manifestString);
  logger.debug(`Writing updated manifest to "${versionFilePath}"...`);
  fs.writeFileSync(versionFilePath, manifestString);

  createSymlinks(versionFilePath, version, previousVersion);
}

/**
 * Commits and pushes the new version of the package to the release registry.
 *
 * @param registry The registry to be pushed to git.
 * @param directory The directory with the checkout out registry.
 * @param remote The GitHub remote object.
 * @param version The new version.
 * @param revision Git commit SHA to be published.
 * @param canonicalName The package's canonical name.
 */
export async function pushVersionToRegistry(
  registry: RegistryTarget,
  directory: string,
  remote: GithubRemote,
  version: string,
  revision: string,
  canonicalName: string
): Promise<void> {
  logger.info(`Cloning "${remote.getRemoteString()}" to "${directory}"...`);
  await simpleGit()
    .silent(true)
    .clone(remote.getRemoteStringWithAuth(), directory);

  await addVersionToRegistry(
    registry,
    directory,
    canonicalName,
    version,
    revision
  );

  const git = simpleGit(directory).silent(true);
  await git.checkout('master');

  // Commit
  await git.add(['.']);
  await git.commit(`craft: release "${canonicalName}", version "${version}"`);

  // Push!
  logger.info(`Pushing the changes...`);
  if (!isDryRun()) {
    await git.push('origin', 'master');
  } else {
    logger.info('[dry-run] Not pushing the branch.');
  }
}
