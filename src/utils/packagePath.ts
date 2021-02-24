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
  return path.posix.join(registryDir, 'packages', ...packageDirs);
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
  return path.posix.join(registryDir, 'apps', ...packageDirs.slice(1));
}

/**
 * Returns the path to the package from its canonical name.
 *
 * @param packageType The type of the registry package.
 * @param registryDir The path to the local registry.
 * @param canonical The app's canonical name.
 */
export function getPackageDirPath(
  packageType: RegistryPackageType,
  registryDir: string,
  canonical: string
): string {
  if (packageType === RegistryPackageType.SDK) {
    return getSdkPackagePath(registryDir, canonical);
  } else if (packageType === RegistryPackageType.APP) {
    return getAppPackagePath(registryDir, canonical);
  } else {
    throw new ConfigurationError(
      `Unknown registry package type: ${packageType}`
    );
  }
}

/**
 * Parses registry canonical name to a list of registry directories
 *
 * Colons can be used as separators in addition to forward slashes.
 *
 * Examples:
 *    "npm:@sentry/browser" -> ["npm", "@sentry", "browser"]
 *    "maven:io.sentry:sentry" -> ["maven", "io.sentry", "sentry"]
 *
 * @param canonicalName Registry canonical name
 * @returns A list of directories
 */
export function parseCanonical(canonicalName: string): string[] {
  const [registry, ...splitPackageName] = canonicalName.split(':');

  // This essentially replaces colons with forward slashes for the package name
  // of the initial canonical name
  const packageName = splitPackageName.join('/');

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
  return [registry].concat(packageDirs);
}
