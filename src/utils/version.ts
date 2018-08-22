import { getGitTagPrefix } from '../config';

/**
 * Regular expression for matching semver versions
 *
 * Modified to match version components
 * Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com)
 * @see https://github.com/sindresorhus/semver-regex
 */
const semverRegex = () =>
  /\bv?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-?([\da-z-]+(?:\.[\da-z-]+)*))?(?:\+([\da-z-]+(?:\.[\da-z-]+)*))?\b/gi;

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
 * Checks if the provided text is a valid version string
 *
 * @param text String to check
 * @returns true if the string is a valid semantic version, false otherwise
 */
export function isValidVersion(text: string): boolean {
  return !!text && text === getVersion(text);
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

/**
 * A regular expression to detect that the version is a pre-release
 */
export const PREVIEW_RELEASE_REGEX = /(?:[^a-z])(preview|pre|rc|dev|alpha|beta|unstable|a|b)(?:[^a-z]|$)/i;

/**
 * Checks that the provided string is a pre-release version.
 *
 * @param text Version string to check
 * @returns True if the string looks like a pre-release version
 */
export function isPreviewRelease(text: string): boolean {
  return isValidVersion(text) && !!text.match(PREVIEW_RELEASE_REGEX);
}

/**
 * Returns the git version based on the provided version
 *
 * If no tag prefix is provided, it is taken from the configuration.
 *
 * @param version Version we're releasing
 * @param tagPrefix Git tag prefix
 * @returns Git tag
 */
export function versionToTag(version: string, tagPrefix?: string): string {
  const prefix = tagPrefix === undefined ? getGitTagPrefix() : tagPrefix;
  return `${prefix}${version}`;
}
