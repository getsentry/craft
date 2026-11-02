import { load } from 'js-yaml';

/**
 * Version patterns and editors shared by the targets that bump versions with
 * direct file edits and by `versioning.files`, so both update the same places
 * the same way. Each pattern captures the text before the version, the
 * version, and the text after it. Each editor returns the updated content, or
 * undefined if it can't find exactly one version to update.
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

/** A TOML `key = "value"` line */
const TOML_STRING_LINE = /^(\s*)([\w.\-"' ]+?)(\s*=\s*)(["'])([^"'\r\n]*)\4/;

/** A YAML key line: indentation, plain or quoted key, and the rest */
const YAML_KEY_LINE = /^( *)(?:([\w$-]+)|"([^"]*)"|'([^']*)'):(?=[ \t]|$)(.*)$/;

/** A YAML scalar value: optional quote, value, closing quote, comment */
const YAML_SCALAR = /^([ \t]*)(["']?)([^"'#\r\n]*?)\2[ \t]*(?:#.*)?$/;

/** Replaces `[start, end)` ranges of `content` with `version`. */
export function replaceRanges(
  content: string,
  ranges: [number, number][],
  version: string,
): string {
  let updated = content;
  for (const [start, end] of [...ranges].sort((a, b) => b[0] - a[0])) {
    updated = updated.slice(0, start) + version + updated.slice(end);
  }
  return updated;
}

/**
 * Sets the string at a dotted `field` path in a TOML file, such as
 * `project.version`, keeping its quotes and the rest of the file. Arrays of
 * tables can't be addressed.
 *
 * @returns The updated content, or undefined unless exactly one string value
 * sits at `field`
 */
export function setTomlVersion(
  content: string,
  field: string,
  newVersion: string,
): string | undefined {
  const target = splitTomlKey(field).join('.');
  const ranges: [number, number][] = [];
  let table: string[] | undefined = [];
  let offset = 0;
  for (const line of content.split('\n')) {
    const lineStart = offset;
    offset += line.length + 1;
    const trimmed = line.trim();
    if (trimmed.startsWith('[[')) {
      table = undefined;
      continue;
    }
    const header = /^\[([^\]]+)\]\s*(?:#.*)?$/.exec(trimmed);
    if (header) {
      table = splitTomlKey(header[1]);
      continue;
    }
    const entry = TOML_STRING_LINE.exec(line);
    if (
      entry &&
      table &&
      [...table, ...splitTomlKey(entry[2])].join('.') === target
    ) {
      const start = lineStart + entry[0].length - entry[5].length - 1;
      ranges.push([start, start + entry[5].length]);
    }
  }
  return ranges.length === 1
    ? replaceRanges(content, ranges, newVersion)
    : undefined;
}

/** Splits a dotted TOML key, dropping quotes around its parts. */
function splitTomlKey(key: string): string[] {
  return key
    .split('.')
    .map(part => part.trim().replace(/^(["'])(.*)\1$/, '$2'));
}

/**
 * Finds the scalar values at a dotted key path in YAML block mappings.
 * Values inside sequences and block scalars are never matched.
 */
function findYamlValues(text: string, field: string): [number, number][] {
  const target = field.split('.');
  const ranges: [number, number][] = [];
  const parents: { indent: number; key?: string }[] = [];
  let blockScalarIndent = -1;
  let offset = 0;
  for (const rawLine of text.split('\n')) {
    const lineStart = offset;
    offset += rawLine.length + 1;
    const line = rawLine.replace(/\r$/, '');
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const indent = line.length - line.trimStart().length;
    if (blockScalarIndent >= 0 && indent > blockScalarIndent) {
      continue;
    }
    blockScalarIndent = -1;
    while (parents.length && parents[parents.length - 1].indent >= indent) {
      parents.pop();
    }
    if (trimmed === '-' || trimmed.startsWith('- ')) {
      // Keys inside sequence items have no addressable path.
      parents.push({ indent });
      continue;
    }
    const entry = YAML_KEY_LINE.exec(line);
    if (!entry) {
      continue;
    }
    const key = entry[2] ?? entry[3] ?? entry[4];
    const rest = entry[5];
    const value = rest.trim();
    if (!value || value.startsWith('#')) {
      parents.push({ indent, key });
      continue;
    }
    if (/^[|>]/.test(value)) {
      blockScalarIndent = indent;
      continue;
    }
    const keys = [...parents.map(parent => parent.key), key];
    const scalar = YAML_SCALAR.exec(rest);
    if (
      scalar &&
      keys.length === target.length &&
      keys.every((part, index) => part === target[index])
    ) {
      const start =
        lineStart +
        line.length -
        rest.length +
        scalar[1].length +
        scalar[2].length;
      ranges.push([start, start + scalar[3].length]);
    }
  }
  return ranges;
}

/**
 * Sets the scalar at a dotted `field` path in YAML, keeping its quotes,
 * comments, and the rest of the file, then checks that a YAML parser reads
 * the new version there.
 *
 * @returns The updated content, or undefined unless exactly one scalar sits
 * at `field` and the edit parses back to the new version
 */
export function setYamlVersion(
  content: string,
  field: string,
  newVersion: string,
): string | undefined {
  const ranges = findYamlValues(content, field);
  if (ranges.length !== 1) {
    return undefined;
  }
  const updated = replaceRanges(content, ranges, newVersion);
  let parsed: unknown;
  try {
    parsed = load(updated);
  } catch {
    return undefined;
  }
  const value = field
    .split('.')
    .reduce<unknown>(
      (node, key) => (node as Record<string, unknown> | undefined)?.[key],
      parsed,
    );
  return String(value) === newVersion ? updated : undefined;
}
