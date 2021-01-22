import * as path from 'path';
import { RegistryPackageType } from '../targets/registry';
import { ConfigurationError } from './errors';

/**
 * Returns the path to the SDK, given its canonical name.
 *
 * @param registryDir The path to the local registry.
 * @param canonical The SDK's canonical name.
 * @returns The SDK path.
 */
function getSdkPackagePath(registryDir: string, canonical: string): string {
  const packageDirs = parseCanonical(canonical);
  return [registryDir, 'packages'].concat(packageDirs).join(path.sep);
}

/**
 * Returns the path to the app, given its canonical name.
 *
 * @param registryDir The path to the local registry.
 * @param canonical The app's canonical name.
 * @returns The app path.
 */
function getAppPackagePath(registryDir: string, canonical: string): string {
  const packageDirs = parseCanonical(canonical);
  if (packageDirs[0] !== 'app') {
    throw new ConfigurationError(
      `Invalid canonical entry for an app: ${canonical}`
    );
  }
  return [registryDir, 'apps'].concat(packageDirs.slice(1)).join(path.sep);
}

/**
 * Returns the path to the package from its canonical name.
 *
 * @param registryDir The path to the local registry.
 * @param canonical The app's canonical name.
 */
export function getPackageDirPath(
  registryConfType: string,
  registryDir: string,
  canonical: string
): string {
  if (registryConfType === RegistryPackageType.SDK) {
    return getSdkPackagePath(registryDir, canonical);
  } else if (registryConfType === RegistryPackageType.APP) {
    return getAppPackagePath(registryDir, canonical);
  } else {
    throw new ConfigurationError(
      `Unknown registry package type: ${registryConfType}`
    );
  }
}

/**
 * Parses registry canonical name to a list of registry directories
 *
 * Example: "npm:@sentry/browser" -> ["npm", "@sentry", "browser"]
 *
 * @param canonicalName Registry canonical name
 * @returns A list of directories
 */
function parseCanonical(canonicalName: string): string[] {
  const [registry, packageName] = canonicalName.split(':');
  if (!registry || !packageName) {
    throw new ConfigurationError(
      `Cannot parse canonical name for the package: ${canonicalName}`
    );
  }
  const packageDirs = packageName.split('/');
  if (packageDirs.some(x => !x)) {
    throw new ConfigurationError(
      `Cannot parse canonical name for the package: ${canonicalName}`
    );
  }
  return [registry].concat(packageName.split('/'));
}
