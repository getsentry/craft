import { getGitTagPrefix } from '../config';

/**
 * Regular expression for matching semver versions.
 *
 * Modified to match version components
 * Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com)
 * @see https://github.com/sindresorhus/semver-regex
 */
const semverRegex = () =>
  /\bv?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-?([\da-z-]+(?:\.[\da-z-]+)*))?(?:\+([\da-z-]+(?:\.[\da-z-]+)*))?\b/gi;

/**
 * Extracts a version number from the given text.
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
 * Checks if the provided text is a valid version string.
 *
 * @param text String to check
 * @returns true if the string is a valid semantic version, false otherwise
 */
export function isValidVersion(text: string): boolean {
  return !!text && text === getVersion(text);
}

/**
 * SemVer is a parsed semantic version.
 */
export interface SemVer {
  /** The major version number */
  major: number;
  /** The minor version number */
  minor: number;
  /** The patch version number */
  patch: number;
  /** Optional pre-release specifier */
  pre?: string;
  /** Optional build metadata */
  build?: string;
}

/**
 * Parses a version number from the given text.
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
 * Returns "true" if version v1 is greater than version v2
 *
 * Example: "1.2.3" is greater than "1.1.0"
 */
export function versionGreaterOrEqualThan(v1: SemVer, v2: SemVer): boolean {
  if (v1.major !== v2.major) {
    return v1.major > v2.major;
  } else if (v1.minor !== v2.minor) {
    return v1.minor > v2.minor;
  } else if (v1.patch !== v2.patch) {
    return v1.patch > v2.patch;
  } else if (!v1.pre && v2.pre) {
    return true;
  } else if (v1.pre && !v2.pre) {
    return false;
  } else if (v1.pre && v2.pre && v1.pre === v2.pre) {
    return v1.build === v2.build;
  } else if (v1.pre && v2.pre && v1.pre !== v2.pre && /^\d+$/.test(v1.pre) && /^\d+$/.test(v2.pre)) {
    return v1.pre > v2.pre;
  } else if (v1.build || v2.build || v1.pre || v2.pre) {
    throw new Error(
      `Cannot compare the two versions: "${JSON.stringify(
        v1
      )}" and "${JSON.stringify(v2)}"`
    );
  }
  return true;
}

/**
 * A regular expression to detect that a version is a pre-release version.
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
 * Returns the Git version based on the provided version.
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

/**
 * Reads "package.json" from project root and returns its contents.
 */
export function getPackage(): any {
  const pkg = require('../../package.json') || {};
  // Sanity check
  if (Object.keys(pkg).length === 0) {
    throw new Error('Invalid package.json: the file is empty!');
  }
  return pkg;
}

/**
 * Reads the package's version from "package.json".
 */
export function getPackageVersion(): string {
  const { version } = getPackage();
  // We set process.env.CRAFT_BUILD_SHA at build time
  const buildInfo = process.env.CRAFT_BUILD_SHA;

  return buildInfo ? `${version} (${buildInfo})` : version;
}

/**
 * Returns the stringified version of the passed SemVer object.
 */
export function semVerToString(s: SemVer) {
  return `${s.major}.${s.minor}.${s.patch}${s.pre ? `-${s.pre}` : ''}${s.build ? `+${s.build}` : ''
    }`;
}
