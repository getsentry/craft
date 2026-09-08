/**
 * Helpers for locating Craft's publish-state file in a path that is NOT
 * writable by the repository being published.
 *
 * Background: `craft publish` writes a small JSON file listing targets
 * that have completed so a resumed run can skip them. Before this module
 * existed, the file lived at `.craft-publish-<version>.json` in the
 * project's cwd. That path is inside the repository checkout, so any
 * committed file at the same path (or any earlier CI step) could
 * pre-populate the "published" set and trick Craft into silently
 * skipping targets.
 *
 * The file now lives under `$XDG_STATE_HOME/craft/` (falling back to
 * `$HOME/.local/state/craft/`). The filename is keyed on
 * owner, repo, a hash of cwd (to disambiguate monorepo subpaths), and
 * the version being published. `getsentry/publish` runs inside a Docker
 * image with `HOME=/root`, so the XDG state dir is a clean,
 * workflow-writable location that committed repo contents cannot reach.
 */

import { createHash } from 'crypto';
import { homedir } from 'os';
import { join } from 'path';

import type { GitHubGlobalConfig } from '../schemas/project_config';

const STATE_DIR_NAME = 'craft';

/**
 * Resolves `$XDG_STATE_HOME/craft/` with the standard fallback to
 * `$HOME/.local/state/craft/` when `XDG_STATE_HOME` is unset.
 *
 * Exported for tests and for the publish workflow helper (see
 * `scripts/print-publish-state-path.ts` if present) that needs to
 * compute the same path.
 */
export function getCraftStateDir(): string {
  const xdgStateHome = process.env.XDG_STATE_HOME;
  if (xdgStateHome && xdgStateHome.length > 0) {
    return join(xdgStateHome, STATE_DIR_NAME);
  }
  return join(homedir(), '.local', 'state', STATE_DIR_NAME);
}

/**
 * Sanitises a string for inclusion in a filename: lowercases, replaces
 * any character outside `[a-z0-9._-]` with `_`, and collapses runs.
 * Owner/repo names are restricted by GitHub to `[A-Za-z0-9._-]` so this
 * is mostly belt-and-braces.
 */
function sanitiseForFilename(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function encodeVersionForFilename(version: string): string {
  const safeVersion = sanitiseForFilename(version);
  return safeVersion === version
    ? safeVersion
    : `version-${Buffer.from(version).toString('base64url')}`;
}

/**
 * Short (12-char) hex digest of the absolute cwd path. Used to
 * disambiguate monorepo subpaths so `packages/foo` and `packages/bar`
 * get separate state files even at the same version.
 */
function shortCwdHash(cwd: string): string {
  return createHash('sha1').update(cwd).digest('hex').slice(0, 12);
}

/**
 * Builds the filename for the publish-state file.
 *
 * With a resolvable GitHub config:
 *   `publish-state-<owner>-<repo>-<sha1(cwd)[:12]>-<version>.json`
 *
 * Without GitHub config (offline / non-GitHub test harnesses) the
 * filename falls back to a cwd-hash-only form so Craft still refuses
 * to write into the repo itself:
 *   `publish-state-<sha256(cwd)[:16]>-<version>.json`
 *
 * When a release workspace is selected, its losslessly encoded name is
 * included before the version so independent release units in the same
 * repository cannot share completed-target state.
 */
export function getPublishStateFilename(
  version: string,
  githubConfig: GitHubGlobalConfig | null,
  cwd: string = process.cwd(),
  workspace?: string,
): string {
  const safeVersion = encodeVersionForFilename(version);
  const workspacePrefix = workspace
    ? `workspace-${Buffer.from(workspace).toString('base64url')}-`
    : '';
  if (githubConfig) {
    const owner = sanitiseForFilename(githubConfig.owner);
    const repo = sanitiseForFilename(githubConfig.repo);
    return `publish-state-${owner}-${repo}-${shortCwdHash(cwd)}-${workspacePrefix}${safeVersion}.json`;
  }
  const cwdDigest = createHash('sha256').update(cwd).digest('hex').slice(0, 16);
  return `publish-state-${cwdDigest}-${workspacePrefix}${safeVersion}.json`;
}

/**
 * Full absolute path to the publish-state file for the given version.
 *
 * @param version The version being published.
 * @param githubConfig Resolved GitHub owner/repo (may be null when
 *   Craft is running outside a GitHub context).
 * @param cwd Override cwd; defaults to `process.cwd()`. Used by tests.
 * @param workspace Optional selected release workspace, used to isolate
 *   publish-resume state for same-repository, same-version releases.
 */
export function getPublishStatePath(
  version: string,
  githubConfig: GitHubGlobalConfig | null,
  cwd: string = process.cwd(),
  workspace?: string,
): string {
  return join(
    getCraftStateDir(),
    getPublishStateFilename(version, githubConfig, cwd, workspace),
  );
}
