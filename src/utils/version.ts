/**
 * Regular expression for matching semver versions
 *
 * Modified to match version components
 * Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com)
 * @see https://github.com/sindresorhus/semver-regex
 */
const semverRegex = () =>
  /\bv?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([\da-z-]+(?:\.[\da-z-]+)*))?(?:\+([\da-z-]+(?:\.[\da-z-]+)*))?\b/gi;

/**
 * Extracts a version number from the given text
 *
 * In case the version contains a leading "v", it is stripped from the result.
 * All semantic versions are supported. See {@link http://semver.org/} for
 * more information.
 *
 * @param text Some text containing a version
 * @returns The extracted version or null
 */
export function getVersion(text: string): string | null {
  const matches = semverRegex().exec(text);
  const version = matches && matches[0];
  return version && version[0].toLowerCase() === 'v'
    ? version.substr(1)
    : version;
}

/**
 * SemVer Parsed semantic version
 */
export interface SemVer {
  /// The major version number
  major: number;
  /// The minor version number
  minor: number;
  /// The patch version number
  patch: number;
  /// Optional pre-release specifier
  pre?: string;
  /// Optional build metadata
  build?: string;
}

/**
 * Parses a version number from the given text
 *
 * @param text Some text containing a version
 * @returns The parsed version or null
 */
export function parseVersion(text: string): SemVer | null {
  const matches = semverRegex().exec(text);
  return (
    matches && {
      build: matches[5],
      major: parseInt(matches[1], 10),
      minor: parseInt(matches[2], 10),
      patch: parseInt(matches[3], 10),
      pre: matches[4],
    }
  );
}
