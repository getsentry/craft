import { readFileSync, realpathSync } from 'fs';
import path from 'path';
import { globSync } from 'glob';
import { findNodeAtLocation, parseTree, type ParseError } from 'jsonc-parser';
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
  replaceRanges,
  setMsBuildVersion,
  setTomlVersion,
  setYamlVersion,
  VERSION_RB_REGEX,
} from './versionPatterns';

const DEFAULT_VERSION_FIELD = 'version';

/** Default `field` for TOML manifests, matching the crates and pypi targets */
const DEFAULT_TOML_FIELDS: Record<string, string> = {
  'Cargo.toml': 'package.version',
  'pyproject.toml': 'project.version',
};

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
    case 'toml': {
      const tomlField =
        file.field ??
        DEFAULT_TOML_FIELDS[path.posix.basename(filePath)] ??
        field;
      return (
        setTomlVersion(content, tomlField, version) ??
        noFieldFound(filePath, tomlField)
      );
    }
    case 'yaml':
      return (
        setYamlVersion(content, field, version) ?? noFieldFound(filePath, field)
      );
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

function noFieldFound(filePath: string, field: string): never {
  throw new ConfigurationError(
    `${filePath} has no single "${field}" value to update. ` +
      'Use format: regex for this file.',
  );
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
    (setYamlVersion(body, field, version) ?? noFieldFound(filePath, field)) +
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
