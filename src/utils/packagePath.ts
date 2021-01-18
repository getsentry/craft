import * as path from 'path';
import { RegistryPackageType } from '../targets/registry';
import { parseCanonical } from './canonical';
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
  registryDir: string,
  canonical: string
): string {
  if (this.registryConfig.type === RegistryPackageType.SDK) {
    return getSdkPackagePath(registryDir, canonical);
  } else if (this.registryConfig.type === RegistryPackageType.APP) {
    return getAppPackagePath(registryDir, canonical);
  } else {
    throw new ConfigurationError(
      `Unknown registry package type: ${this.registryConfig.type}`
    );
  }
}
