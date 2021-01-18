import { ConfigurationError } from './errors';

/**
 * Parses registry canonical name to a list of registry directories
 *
 * Example: "npm:@sentry/browser" -> ["npm", "@sentry", "browser"]
 *
 * @param canonicalName Registry canonical name
 * @returns A list of directories
 */
export function parseCanonical(canonicalName: string): string[] {
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
