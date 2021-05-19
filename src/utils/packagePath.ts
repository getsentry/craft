import * as path from 'path';
import { RegistryPackageType } from '../targets/registry';
import { ConfigurationError } from './errors';

/**
 * Returns the path to the SDK, given its canonical name.
 *
 * @param canonical The SDK's canonical name.
 * @returns The SDK path.
 */
function getSdkPackagePath(canonical: string): string {
  const packageDirs = parseCanonical(canonical);
  return path.join('packages', ...packageDirs);
}

/**
 * Returns the path to the app, given its canonical name.
 *
 * @param canonical The app's canonical name.
 * @returns The app path.
 */
function getAppPackagePath(canonical: string): string {
  const packageDirs = parseCanonical(canonical);
  if (packageDirs[0] !== 'app') {
    throw new ConfigurationError(
      `Invalid canonical entry for an app: ${canonical}`
    );
  }
  return path.join('apps', ...packageDirs.slice(1));
}

/**
 * Returns the path to the package from its canonical name.
 *
 * @param packageType The type of the registry package.
 * @param canonical The app's canonical name.
 */
export function getPackageDirPath(
  packageType: RegistryPackageType,
  canonical: string
): string {
  switch (packageType) {
    case RegistryPackageType.SDK:
      return getSdkPackagePath(canonical);
    case RegistryPackageType.APP:
      return getAppPackagePath(canonical);
    default:
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
  const registrySepPosition = canonicalName.indexOf(':');
  if (registrySepPosition === -1) {
    throw new ConfigurationError(
      `Cannot parse canonical name for the package: ${canonicalName}`
    );
  }
  const registry = canonicalName.slice(0, registrySepPosition);
  const packageName = canonicalName.slice(registrySepPosition + 1);

  const packageDirs = packageName.split(/[:/]/);
  if (packageDirs.some(x => !x)) {
    throw new ConfigurationError(
      `Cannot parse canonical name for the package: ${canonicalName}`
    );
  }
  return [registry, ...packageDirs];
}
