/**
 * Version patterns shared by the targets that bump versions with direct file
 * edits and by `versioning.files`, so both update the same places. Each
 * pattern captures the text before the version, the version, and the text
 * after it.
 */

/** Matches `s.version = "1.0.0"` in a gemspec */
export const GEMSPEC_VERSION_REGEX =
  /^(\s*\w+\.version\s*=\s*["'])([^"']+)(["'])/m;

/** Matches `VERSION = "1.0.0"` in a version.rb file */
export const VERSION_RB_REGEX = /^(\s*VERSION\s*=\s*["'])([^"']+)(["'])/m;

/** Match `version: "1.0.0"` and `@version "1.0.0"` in mix.exs */
export const MIX_VERSION_PATTERNS = [
  /^(\s*version:\s*["'])([^"']+)(["'])/m,
  /^(\s*@version\s+["'])([^"']+)(["'])/m,
];

/** MSBuild properties that hold a project's version */
const MSBUILD_VERSION_PATTERNS = [
  /(<Version>)([^<]+)(<\/Version>)/g,
  /(<VersionPrefix>)([^<]+)(<\/VersionPrefix>)/g,
  /(<PackageVersion>)([^<]+)(<\/PackageVersion>)/g,
  /(<AssemblyVersion>)([^<]+)(<\/AssemblyVersion>)/g,
  /(<FileVersion>)([^<]+)(<\/FileVersion>)/g,
];

/**
 * Sets every version property in an MSBuild file (.csproj,
 * Directory.Build.props, ...).
 *
 * @returns The updated content, or undefined if the file has no version
 * property
 */
export function setMsBuildVersion(
  content: string,
  newVersion: string,
): string | undefined {
  let newContent = content;
  let updated = false;

  for (const pattern of MSBUILD_VERSION_PATTERNS) {
    if (pattern.test(newContent)) {
      // Reset lastIndex for global regex
      pattern.lastIndex = 0;
      newContent = newContent.replace(pattern, `$1${newVersion}$3`);
      updated = true;
    }
  }

  if (!updated) {
    return undefined;
  }

  // MSBuild appends <VersionSuffix> to <VersionPrefix>, so clear it to keep
  // the package version equal to the full new version written above.
  if (/<VersionPrefix>/.test(newContent)) {
    newContent = newContent.replace(
      /(<VersionSuffix>)[^<]*(<\/VersionSuffix>)/g,
      '$1$2',
    );
  }

  return newContent;
}
