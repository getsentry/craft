import { readFileSync, realpathSync } from 'fs';
import path from 'path';
import { globSync } from 'glob';
import { findNodeAtLocation, parseTree, type ParseError } from 'jsonc-parser';
import { load } from 'js-yaml';
import * as semver from 'semver';

import { logger } from '../logger';
import {
  getVersionFileFormat,
  type VersionFileConfig,
} from '../schemas/project_config';
import { safeFs } from './dryRun';
import { ConfigurationError } from './errors';
import { stringToRegexp } from './filters';
import {
  GEMSPEC_VERSION_REGEX,
  MIX_VERSION_PATTERNS,
  setMsBuildVersion,
  VERSION_RB_REGEX,
} from './versionPatterns';

const DEFAULT_VERSION_FIELD = 'version';

/** Default `field` for TOML manifests, matching the crates and pypi targets */
const DEFAULT_TOML_FIELDS: Record<string, string> = {
  'Cargo.toml': 'package.version',
  'pyproject.toml': 'project.version',
};

/** A YAML key line: indentation, plain or quoted key, and the rest */
const YAML_KEY_LINE = /^( *)(?:([\w$-]+)|"([^"]*)"|'([^']*)'):(?=[ \t]|$)(.*)$/;

/** A YAML scalar value: optional quote, value, closing quote, comment */
const YAML_SCALAR = /^([ \t]*)(["']?)([^"'#\r\n]*?)\2[ \t]*(?:#.*)?$/;

/** A TOML `key = "value"` line */
const TOML_STRING_LINE = /^(\s*)([\w.\-"' ]+?)(\s*=\s*)(["'])([^"'\r\n]*)\4/;

/** Opening `---` line, frontmatter body, closing `---` line. */
const FRONTMATTER_REGEX = /^(---\r?\n)([\s\S]*?\r?\n)?---(?:\r?\n|$)/;

/**
 * Writes the release version into every file listed in `versioning.files`.
 *
 * Every entry is resolved and rewritten in memory before anything is written,
 * so a misconfigured entry fails the release without leaving partial edits.
 *
 * @param files Entries from `versioning.files`
 * @param repoRoot Repository root that entry paths are relative to
 * @param newVersion Version being released
 * @returns Repository-relative paths of every matched file, sorted
 * @throws ConfigurationError if an entry matches no files or a matched file
 * has no version to update
 */
export function updateVersionFiles(
  files: VersionFileConfig[],
  repoRoot: string,
  newVersion: string,
): string[] {
  const contents = new Map<string, { original: string; updated: string }>();

  for (const file of files) {
    const version = file.stripPrerelease
      ? stripPrerelease(newVersion)
      : newVersion;
    const matches = findVersionFiles(file.path, repoRoot);
    if (matches.length === 0) {
      throw new ConfigurationError(
        `versioning.files: "${file.path}" does not match any files.`,
      );
    }

    for (const match of matches) {
      let entry = contents.get(match);
      if (!entry) {
        const original = readFileSync(path.join(repoRoot, match), 'utf-8');
        entry = { original, updated: original };
        contents.set(match, entry);
      }
      entry.updated = setFileVersion(entry.updated, file, version, match);
    }
  }

  for (const [match, { original, updated }] of contents) {
    if (updated === original) {
      logger.debug(`${match} already has the release version`);
      continue;
    }
    safeFs.writeFileSync(path.join(repoRoot, match), updated);
    logger.info(`Updated the version in ${match}`);
  }

  return [...contents.keys()].sort();
}

/**
 * Lists the files a `versioning.files` path matches, relative to the
 * repository root. Matches that resolve outside the root, such as symlinks to
 * other directories, are dropped.
 */
function findVersionFiles(pattern: string, repoRoot: string): string[] {
  const realRoot = realpathSync(repoRoot);
  return globSync(pattern, {
    cwd: repoRoot,
    dot: true,
    nodir: true,
    posix: true,
    ignore: ['**/.git/**', '**/node_modules/**'],
  }).filter(match => {
    let realMatch: string;
    try {
      realMatch = realpathSync(path.join(repoRoot, match));
    } catch (error) {
      // Broken symlinks have nothing to update.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return false;
      }
      throw error;
    }
    return realMatch.startsWith(`${realRoot}${path.sep}`);
  });
}

function setFileVersion(
  content: string,
  file: VersionFileConfig,
  version: string,
  filePath: string,
): string {
  const field = file.field ?? DEFAULT_VERSION_FIELD;
  switch (getVersionFileFormat(file)) {
    case 'json':
      return setJsonVersion(content, field, version, filePath);
    case 'toml':
      return setTomlVersion(
        content,
        file.field ??
          DEFAULT_TOML_FIELDS[path.posix.basename(filePath)] ??
          field,
        version,
        filePath,
      );
    case 'yaml':
      return setYamlVersion(content, field, version, filePath);
    case 'frontmatter':
      return setFrontmatterVersion(content, field, version, filePath);
    case 'msbuild':
      return setMsBuildVersion(content, version) ?? noVersionFound(filePath);
    case 'gem':
      return setPatternVersions(
        content,
        [GEMSPEC_VERSION_REGEX, VERSION_RB_REGEX],
        version,
        filePath,
      );
    case 'mix':
      return setPatternVersions(
        content,
        MIX_VERSION_PATTERNS,
        version,
        filePath,
      );
    case 'regex':
      return setRegexVersion(content, file.pattern ?? '', version, filePath);
    default:
      // The config schema rejects entries without a known format.
      throw new ConfigurationError(
        `versioning.files: cannot tell the format of "${file.path}".`,
      );
  }
}

function noVersionFound(filePath: string): never {
  throw new ConfigurationError(`${filePath} has no version to update.`);
}

/** Replaces `[start, end)` ranges of `content` with `version`. */
function replaceRanges(
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

/** Throws unless exactly one key matched. */
function requireOneMatch(
  ranges: [number, number][],
  field: string,
  filePath: string,
): void {
  if (ranges.length !== 1) {
    throw new ConfigurationError(
      `${filePath} must have exactly one "${field}" string value, found ` +
        `${ranges.length}.`,
    );
  }
}

/**
 * Replaces the string at a dotted `field` path, leaving the rest of the file,
 * including its formatting, untouched.
 */
function setJsonVersion(
  content: string,
  field: string,
  version: string,
  filePath: string,
): string {
  const errors: ParseError[] = [];
  const tree = parseTree(content, errors, {
    allowTrailingComma: false,
    disallowComments: true,
  });
  if (!tree || errors.length > 0) {
    throw new ConfigurationError(`${filePath} is not valid JSON.`);
  }
  const node = findNodeAtLocation(tree, field.split('.'));
  if (node?.type !== 'string') {
    throw new ConfigurationError(
      `${filePath} has no string "${field}" field to update.`,
    );
  }
  return (
    content.slice(0, node.offset) +
    JSON.stringify(version) +
    content.slice(node.offset + node.length)
  );
}

/**
 * Replaces the string at a dotted `field` path in a TOML file, keeping its
 * quotes and the rest of the file. Arrays of tables can't be addressed.
 */
function setTomlVersion(
  content: string,
  field: string,
  version: string,
  filePath: string,
): string {
  const target = splitKey(field).join('.');
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
      table = splitKey(header[1]);
      continue;
    }
    const entry = TOML_STRING_LINE.exec(line);
    if (
      entry &&
      table &&
      [...table, ...splitKey(entry[2])].join('.') === target
    ) {
      const start = lineStart + entry[0].length - entry[5].length - 1;
      ranges.push([start, start + entry[5].length]);
    }
  }
  requireOneMatch(ranges, field, filePath);
  return replaceRanges(content, ranges, version);
}

/** Splits a dotted TOML key, dropping quotes around its parts. */
function splitKey(key: string): string[] {
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
 * Replaces the scalar at a dotted `field` path in YAML, keeping its quotes
 * and comments, then checks that a YAML parser reads the new version there.
 */
function setYamlVersion(
  content: string,
  field: string,
  version: string,
  filePath: string,
): string {
  const ranges = findYamlValues(content, field);
  requireOneMatch(ranges, field, filePath);
  const updated = replaceRanges(content, ranges, version);
  let parsed: unknown;
  try {
    parsed = load(updated);
  } catch {
    throw new ConfigurationError(`${filePath} is not valid YAML.`);
  }
  const value = field
    .split('.')
    .reduce<unknown>(
      (node, key) => (node as Record<string, unknown> | undefined)?.[key],
      parsed,
    );
  if (String(value) !== version) {
    throw new ConfigurationError(
      `Could not update "${field}" in ${filePath} without changing its YAML ` +
        'structure. Use format: regex for this file.',
    );
  }
  return updated;
}

/** Updates a YAML `field` in Markdown frontmatter. */
function setFrontmatterVersion(
  content: string,
  field: string,
  version: string,
  filePath: string,
): string {
  const frontmatter = FRONTMATTER_REGEX.exec(content);
  if (!frontmatter) {
    throw new ConfigurationError(`${filePath} has no YAML frontmatter.`);
  }
  const [, opening, body = ''] = frontmatter;
  return (
    opening +
    setYamlVersion(body, field, version, filePath) +
    content.slice(opening.length + body.length)
  );
}

/**
 * Replaces the version in the first match of each pattern, the way the
 * gem and hex targets do. Each pattern captures prefix, version, and suffix.
 */
function setPatternVersions(
  content: string,
  patterns: RegExp[],
  version: string,
  filePath: string,
): string {
  let updated = content;
  let matched = false;
  for (const pattern of patterns) {
    updated = updated.replace(pattern, (_match, prefix, _old, suffix) => {
      matched = true;
      return `${prefix}${version}${suffix}`;
    });
  }
  return matched ? updated : noVersionFound(filePath);
}

/**
 * Replaces the capturing group of every match of a `/source/flags` pattern.
 */
function setRegexVersion(
  content: string,
  pattern: string,
  version: string,
  filePath: string,
): string {
  const { source, flags } = stringToRegexp(pattern);
  // `g` finds every match and `d` reports where the capturing group sits.
  const regex = new RegExp(source, `${flags.replace(/[dgy]/g, '')}dg`);
  const groups = [...content.matchAll(regex)].map(match => match.indices?.[1]);
  if (groups.length === 0 || groups.some(group => !group)) {
    throw new ConfigurationError(
      `${filePath} has no match for ${pattern} to update.`,
    );
  }
  return replaceRanges(content, groups as [number, number][], version);
}

/** Returns `major.minor.patch`, dropping prerelease and build metadata. */
function stripPrerelease(version: string): string {
  const parsed = semver.parse(version);
  if (!parsed) {
    throw new ConfigurationError(
      `Cannot strip the prerelease from "${version}": not a valid semver version.`,
    );
  }
  return `${parsed.major}.${parsed.minor}.${parsed.patch}`;
}
