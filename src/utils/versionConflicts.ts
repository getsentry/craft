import { writeFile } from 'fs/promises';
import path from 'path';
import type { SimpleGit } from 'simple-git';

import { logger } from '../logger';
import { safeFs } from './dryRun';
import { withTempDir } from './files';

/**
 * Conflict marker size passed to `git merge-file`. Large enough that file
 * content (e.g. a Markdown setext heading underlined with `=======`) is not
 * mistaken for a marker.
 */
const MARKER_SIZE = 32;
const OURS_MARKER = '<'.repeat(MARKER_SIZE);
const BASE_MARKER = '|'.repeat(MARKER_SIZE);
const SEPARATOR_MARKER = '='.repeat(MARKER_SIZE);
const THEIRS_MARKER = '>'.repeat(MARKER_SIZE);

/**
 * A version-like token: at least `MAJOR.MINOR`, optionally followed by
 * dot, dash or plus separated segments (`1.2.3`, `1.2.3-dev.0`,
 * `1.2.3.dev0`, `24.1.0+build.5`).
 */
const VERSION_PATTERN = '\\d+\\.[0-9A-Za-z]+(?:[-+.][0-9A-Za-z]+)*';

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Matches `version` only where it is a whole version token, so `1.2.3` does
 * not match inside `11.2.3` or `1.2.3-dev.0`.
 */
function wholeVersionRegExp(version: string): RegExp {
  return new RegExp(
    `(?<![0-9.])${escapeRegExp(version)}(?![0-9A-Za-z]|[-+.][0-9A-Za-z])`,
    'g',
  );
}

/**
 * Resolves one conflict hunk when the release side only replaced version
 * tokens with `version`.
 *
 * The release branch side (`theirs`) must equal the merge base (`base`)
 * except for version tokens that became `version`. The resolution applies
 * the same replacement to the target branch side (`ours`), keeping every
 * other change the target branch made.
 *
 * @returns The resolved hunk, or null when the release side changed more
 *   than versions, or the target side no longer has the old version.
 */
export function resolveVersionBumpHunk(
  ours: string,
  base: string,
  theirs: string,
  version: string,
): string | null {
  // `theirs` = t0 V t1 V ... tn, where V is the release version. `base` must
  // have the same text with a version token in place of each V.
  const parts = theirs.split(wholeVersionRegExp(version));
  if (parts.length < 2) {
    return null;
  }
  const basePattern = new RegExp(
    `^${parts.map(escapeRegExp).join(`(${VERSION_PATTERN})`)}$`,
  );
  const match = basePattern.exec(base);
  if (!match) {
    return null;
  }

  const oldVersions = new Set(match.slice(1).filter(v => v !== version));
  if (oldVersions.size === 0) {
    return null;
  }

  let resolved = ours;
  for (const oldVersion of oldVersions) {
    const oldVersionRegExp = wholeVersionRegExp(oldVersion);
    if (resolved.search(oldVersionRegExp) === -1) {
      // The target branch changed the version line itself; let a human
      // decide which version it should have.
      return null;
    }
    resolved = resolved.replace(oldVersionRegExp, version);
  }
  return resolved;
}

function isMarker(line: string, marker: string): boolean {
  if (!line.startsWith(marker)) {
    return false;
  }
  const next = line.charAt(marker.length);
  return next === '' || next === ' ' || next === '\n' || next === '\r';
}

/**
 * Resolves every conflict hunk in `git merge-file --diff3` output that only
 * conflicts because of a version bump on the release side.
 *
 * @param merged Output of `git merge-file -p --diff3` with markers of
 *   `MARKER_SIZE` characters
 * @param version The released version
 * @returns The fully resolved content, or null if any hunk cannot be
 *   resolved this way
 */
export function resolveVersionBumpConflicts(
  merged: string,
  version: string,
): string | null {
  const lines = merged.split(/(?<=\n)/);
  const output: string[] = [];
  let state: 'outside' | 'ours' | 'base' | 'theirs' = 'outside';
  let ours = '';
  let base = '';
  let theirs = '';
  let resolvedAny = false;

  for (const line of lines) {
    switch (state) {
      case 'outside':
        if (isMarker(line, OURS_MARKER)) {
          state = 'ours';
          ours = base = theirs = '';
        } else {
          output.push(line);
        }
        break;
      case 'ours':
        if (isMarker(line, BASE_MARKER)) {
          state = 'base';
        } else if (
          isMarker(line, SEPARATOR_MARKER) ||
          isMarker(line, OURS_MARKER) ||
          isMarker(line, THEIRS_MARKER)
        ) {
          // Without the base section we cannot tell what the release changed.
          return null;
        } else {
          ours += line;
        }
        break;
      case 'base':
        if (isMarker(line, SEPARATOR_MARKER)) {
          state = 'theirs';
        } else if (
          isMarker(line, OURS_MARKER) ||
          isMarker(line, BASE_MARKER) ||
          isMarker(line, THEIRS_MARKER)
        ) {
          return null;
        } else {
          base += line;
        }
        break;
      case 'theirs':
        if (isMarker(line, THEIRS_MARKER)) {
          const resolved = resolveVersionBumpHunk(ours, base, theirs, version);
          if (resolved === null) {
            return null;
          }
          output.push(resolved);
          resolvedAny = true;
          state = 'outside';
        } else if (
          isMarker(line, OURS_MARKER) ||
          isMarker(line, BASE_MARKER) ||
          isMarker(line, SEPARATOR_MARKER)
        ) {
          return null;
        } else {
          theirs += line;
        }
        break;
    }
  }

  if (state !== 'outside' || !resolvedAny) {
    return null;
  }
  return output.join('');
}

interface UnmergedEntry {
  base?: string;
  ours?: string;
  theirs?: string;
}

/**
 * Lists unmerged index entries as repository-root-relative paths mapped to
 * the blob of each conflict stage.
 */
async function getUnmergedEntries(
  git: SimpleGit,
): Promise<Map<string, UnmergedEntry>> {
  const output = await git.raw(['ls-files', '-u', '-z', '--full-name']);
  const entries = new Map<string, UnmergedEntry>();
  for (const record of output.split('\0')) {
    // "<mode> <object> <stage>\t<path>"
    const match = /^\d+ ([0-9a-f]+) ([123])\t(.+)$/s.exec(record);
    if (!match) {
      continue;
    }
    const [, object, stage, file] = match;
    const entry = entries.get(file) ?? {};
    if (stage === '1') {
      entry.base = object;
    } else if (stage === '2') {
      entry.ours = object;
    } else {
      entry.theirs = object;
    }
    entries.set(file, entry);
  }
  return entries;
}

/**
 * Resolves an in-progress merge whose conflicts are caused only by the
 * release version bump, then commits the merge.
 *
 * The release branch bumps version strings (e.g. `1.2.0-dev.0` to `1.2.0`).
 * When the target branch changed lines next to those strings after the
 * release branch was cut, Git reports a conflict even though the intent of
 * both sides is clear. For each such hunk, this keeps the target branch's
 * content and applies the version bump to it.
 *
 * Nothing is written unless every conflicted file can be resolved this way.
 *
 * @param git Git client with a conflicted merge in progress
 * @param version The released version that the release branch bumped to
 * @returns The resolved files, or null if the merge was left untouched
 */
export async function resolveVersionBumpMergeConflicts(
  git: SimpleGit,
  version: string,
): Promise<string[] | null> {
  const entries = await getUnmergedEntries(git);
  if (entries.size === 0) {
    return null;
  }

  const repoRoot = (await git.revparse(['--show-toplevel'])).trim();
  const resolutions = new Map<string, string>();

  for (const [file, entry] of entries) {
    if (!entry.base || !entry.ours || !entry.theirs) {
      // Add/add, modify/delete, and rename conflicts are not version bumps.
      logger.debug(`Cannot auto-resolve "${file}": not a content conflict.`);
      return null;
    }
    const stages = {
      ours: entry.ours,
      base: entry.base,
      theirs: entry.theirs,
    };
    const merged = await withTempDir(
      async directory => {
        const paths: string[] = [];
        for (const [name, object] of Object.entries(stages)) {
          const content = await git.raw(['cat-file', 'blob', object]);
          // Skip binary and non-UTF-8 files: they would not survive the
          // round trip through a JS string.
          if (content.includes('\0') || content.includes('\uFFFD')) {
            return null;
          }
          const stagePath = path.join(directory, name);
          await writeFile(stagePath, content);
          paths.push(stagePath);
        }
        // Exits with the number of conflicts. simple-git only rejects when
        // there is also stderr output, which `-q` suppresses for conflicts.
        return git.raw([
          'merge-file',
          '-p',
          '-q',
          '--diff3',
          `--marker-size=${MARKER_SIZE}`,
          ...paths,
        ]);
      },
      true,
      'craft-merge-',
    );
    if (merged === null) {
      logger.debug(`Cannot auto-resolve "${file}": not a UTF-8 text file.`);
      return null;
    }

    const resolved = resolveVersionBumpConflicts(merged, version);
    if (resolved === null) {
      logger.debug(
        `Cannot auto-resolve "${file}": the conflict is not only a version bump.`,
      );
      return null;
    }
    resolutions.set(file, resolved);
  }

  for (const [file, content] of resolutions) {
    const filePath = path.join(repoRoot, file);
    await safeFs.writeFile(filePath, content);
    await git.add(filePath);
  }
  await git.raw(['commit', '--no-edit']);
  return [...resolutions.keys()];
}
