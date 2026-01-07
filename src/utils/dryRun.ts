/**
 * Dry-run abstraction layer for destructive operations.
 *
 * This module provides Proxy-wrapped versions of external libraries/APIs that
 * automatically respect the --dry-run flag. Instead of checking isDryRun() in
 * every function, use these wrapped versions which intercept mutating operations.
 *
 * Dry-run has two modes:
 * 1. Worktree mode: Operations run in a temp worktree, only remote ops are blocked
 * 2. Strict mode: All mutating operations are blocked (fallback)
 *
 * For commands that need to preview changes (like `prepare`), use `createDryRunIsolation()`
 * which provides a unified interface for worktree-based dry-run with automatic cleanup.
 */
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { existsSync, symlinkSync, lstatSync } from 'fs';
import { rm } from 'fs/promises';

import simpleGit, { type SimpleGit } from 'simple-git';
import type { Octokit } from '@octokit/rest';

import { logger } from '../logger';
import { isDryRun } from './helpers';

// ============================================================================
// Worktree Mode Context (Internal State)
// ============================================================================

/**
 * When true, we're running in a worktree and local operations are allowed.
 * Only remote operations (push, GitHub API mutations) are blocked.
 */
let _inWorktreeMode = false;

/**
 * Enable worktree mode for dry-run.
 * In this mode, local git and fs operations are allowed since they happen
 * in a temporary worktree that will be cleaned up.
 *
 * @internal This is managed by createDryRunIsolation() and exposed for testing.
 */
export function enableWorktreeMode(): void {
  _inWorktreeMode = true;
  logger.debug('[dry-run] Worktree mode enabled - local operations allowed');
}

/**
 * Disable worktree mode and return to strict dry-run.
 *
 * @internal This is managed by createDryRunIsolation() and exposed for testing.
 */
export function disableWorktreeMode(): void {
  _inWorktreeMode = false;
  logger.debug('[dry-run] Worktree mode disabled');
}

/**
 * Check if we're currently in worktree mode.
 * This is used by other modules (system.ts, etc.) to determine if
 * operations should be allowed in dry-run mode.
 */
export function isInWorktreeMode(): boolean {
  return _inWorktreeMode;
}

/**
 * Log a dry-run message with consistent formatting.
 */
export function logDryRun(operation: string): void {
  logger.info(`[dry-run] Would execute: ${operation}`);
}

// ============================================================================
// Dry-Run Isolation (Worktree-based)
// ============================================================================

/**
 * Represents an isolated dry-run environment.
 *
 * This interface provides a clean way to run operations in a temporary
 * worktree without affecting the user's repository. All local operations
 * (file writes, git commits) happen in the isolated environment, while
 * remote operations (push, GitHub API) are blocked.
 */
export interface DryRunIsolation {
  /** Path to the temporary worktree directory */
  worktreePath: string;
  /** Original working directory before switching to worktree */
  originalCwd: string;
  /** Git client for the worktree */
  git: SimpleGit;
  /** Whether operating in an isolated worktree (true in dry-run, false in real mode) */
  isIsolated: boolean;
  /** Shows a formatted diff of changes made in the worktree */
  showDiff(): Promise<void>;
  /** Cleans up the worktree and restores original state */
  cleanup(): Promise<void>;
}

// Track active worktree for cleanup on unexpected exit
let _activeWorktreeCleanup: (() => Promise<void>) | null = null;

/**
 * Register signal handlers for cleanup on Ctrl+C or unexpected exit.
 */
function registerCleanupHandlers(cleanup: () => Promise<void>): void {
  _activeWorktreeCleanup = cleanup;

  const handleSignal = async (signal: string): Promise<void> => {
    if (_activeWorktreeCleanup) {
      logger.info(`\n[dry-run] Received ${signal}, cleaning up worktree...`);
      try {
        await _activeWorktreeCleanup();
      } catch (err) {
        logger.debug(`[dry-run] Cleanup error: ${err}`);
      }
      _activeWorktreeCleanup = null;
    }
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };

  process.once('SIGINT', () => handleSignal('SIGINT'));
  process.once('SIGTERM', () => handleSignal('SIGTERM'));
}

/**
 * Unregister cleanup handlers after normal cleanup.
 */
function unregisterCleanupHandlers(): void {
  _activeWorktreeCleanup = null;
  process.removeAllListeners('SIGINT');
  process.removeAllListeners('SIGTERM');
}

/**
 * Directories that should be symlinked from the original repo to the worktree.
 */
const SYMLINK_DIRS = [
  'node_modules',
  'vendor',
  '.venv',
  'venv',
  '__pycache__',
  '.gradle',
  'build',
  'target',
  'Pods',
];

/**
 * Symlinks dependency directories from the original repo to the worktree.
 */
function symlinkDependencyDirs(
  originalCwd: string,
  worktreePath: string
): void {
  for (const dir of SYMLINK_DIRS) {
    const srcPath = join(originalCwd, dir);
    const destPath = join(worktreePath, dir);

    if (existsSync(srcPath) && lstatSync(srcPath).isDirectory()) {
      try {
        symlinkSync(srcPath, destPath);
        logger.debug(`[dry-run] Symlinked ${dir} to worktree`);
      } catch (err) {
        logger.debug(`[dry-run] Could not symlink ${dir}: ${err}`);
      }
    }
  }
}

/**
 * Creates an isolated dry-run environment using a git worktree.
 *
 * This function:
 * 1. In non-dry-run mode: returns a passthrough object (no-op methods, original git)
 * 2. In dry-run mode: creates a temporary git worktree at /tmp/craft-dry-run-*
 * 3. Symlinks dependency directories (node_modules, etc.)
 * 4. Enables worktree mode so local operations are allowed
 * 5. Changes process.cwd() to the worktree
 * 6. Returns an isolation object with cleanup and diff methods
 *
 * Usage:
 * ```typescript
 * const isolation = await createDryRunIsolation(git, rev);
 * git = isolation.git;
 * try {
 *   // Use isolation.git for git operations
 *   // All local changes happen in isolation.worktreePath (or real repo in non-dry-run)
 *   await isolation.showDiff();
 * } finally {
 *   await isolation.cleanup();
 * }
 * ```
 *
 * @param git Git client for the original repository
 * @param rev Revision to base the worktree on (defaults to HEAD)
 * @returns DryRunIsolation object (passthrough in non-dry-run mode)
 */
export async function createDryRunIsolation(
  git: SimpleGit,
  rev?: string
): Promise<DryRunIsolation> {
  // If not in dry-run mode, return a passthrough that does nothing
  if (!isDryRun()) {
    return {
      worktreePath: process.cwd(),
      originalCwd: process.cwd(),
      git, // Use original git client
      isIsolated: false, // Not in isolated worktree
      showDiff: async () => {}, // No-op
      cleanup: async () => {}, // No-op
    };
  }

  const originalCwd = process.cwd();
  const originalHead = (await git.revparse(['HEAD'])).trim();
  const revision = rev || originalHead;

  // Generate a unique temp directory name
  const randomSuffix = randomBytes(8).toString('hex');
  const worktreePath = join(tmpdir(), `craft-dry-run-${randomSuffix}`);

  logger.info(`[dry-run] Creating temporary worktree at ${worktreePath}`);

  // Create the worktree using raw git (bypassing dry-run proxy)
  // eslint-disable-next-line no-restricted-syntax -- This is the wrapper module
  const rawGit = simpleGit(originalCwd);
  await rawGit.raw(['worktree', 'add', '--detach', worktreePath, revision]);

  // Symlink large directories
  symlinkDependencyDirs(originalCwd, worktreePath);

  // Create git client for worktree
  // eslint-disable-next-line no-restricted-syntax -- This is the wrapper module
  const worktreeGit = createDryRunGit(simpleGit(worktreePath));

  // Enable worktree mode so local operations are allowed
  enableWorktreeMode();

  // Change to worktree directory
  process.chdir(worktreePath);

  const cleanup = async (): Promise<void> => {
    logger.debug(`[dry-run] Cleaning up temporary worktree at ${worktreePath}`);
    unregisterCleanupHandlers();
    disableWorktreeMode();
    process.chdir(originalCwd);

    try {
      // eslint-disable-next-line no-restricted-syntax -- This is the wrapper module
      const cleanupGit = simpleGit(originalCwd);
      await cleanupGit.raw(['worktree', 'remove', '--force', worktreePath]);
    } catch (err) {
      logger.debug(
        `[dry-run] Git worktree remove failed, cleaning up manually: ${err}`
      );
      try {
        await rm(worktreePath, { recursive: true, force: true });
        // eslint-disable-next-line no-restricted-syntax -- This is the wrapper module
        const pruneGit = simpleGit(originalCwd);
        await pruneGit.raw(['worktree', 'prune']);
      } catch (rmErr) {
        logger.warn(`[dry-run] Failed to clean up worktree: ${rmErr}`);
      }
    }
  };

  // Register signal handlers for cleanup on Ctrl+C
  registerCleanupHandlers(cleanup);

  const showDiff = async (): Promise<void> => {
    // eslint-disable-next-line no-restricted-syntax -- This is the wrapper module
    const diffGit = simpleGit(worktreePath);
    const worktreeHead = (await diffGit.revparse(['HEAD'])).trim();
    const diffSummary = await diffGit.diffSummary([originalHead, worktreeHead]);

    if (diffSummary.files.length === 0) {
      logger.info('\n[dry-run] No changes would be made.');
      return;
    }

    console.log('\n' + '━'.repeat(70));
    console.log(" Dry-run complete. Here's what would change:");
    console.log('━'.repeat(70) + '\n');

    console.log(`Files changed: ${diffSummary.files.length}`);
    for (const file of diffSummary.files) {
      const status = file.binary
        ? 'B'
        : file.insertions > 0 && file.deletions > 0
          ? 'M'
          : file.insertions > 0
            ? 'A'
            : 'D';
      console.log(` ${status} ${file.file}`);
    }
    console.log('');

    const diff = await diffGit.diff([
      originalHead,
      worktreeHead,
      '--color=always',
    ]);
    if (diff) {
      console.log(diff);
    }

    console.log('━'.repeat(70));
    console.log('[dry-run] No actual changes were made to your repository.');
    console.log('━'.repeat(70) + '\n');
  };

  return {
    worktreePath,
    originalCwd,
    git: worktreeGit,
    isIsolated: true, // Operating in isolated worktree
    showDiff,
    cleanup,
  };
}

// ============================================================================
// Git Proxy
// ============================================================================

/**
 * Git methods that affect remote state and should ALWAYS be blocked in dry-run.
 */
const GIT_REMOTE_METHODS = new Set(['push']);

/**
 * Git methods that modify local state only.
 * Blocked in strict dry-run, but allowed in worktree mode.
 */
const GIT_LOCAL_METHODS = new Set([
  'commit',
  'checkout',
  'checkoutBranch',
  'checkoutLocalBranch',
  'merge',
  'branch',
  'addTag',
  'rm',
  'add',
  'pull',
  'reset',
  'revert',
  'stash',
  'tag',
]);

/**
 * Git raw commands that affect remote state - always blocked.
 */
const GIT_RAW_REMOTE_COMMANDS = new Set(['push']);

/**
 * Git raw commands that modify local state only.
 */
const GIT_RAW_LOCAL_COMMANDS = new Set([
  'commit',
  'checkout',
  'merge',
  'tag',
  'rm',
  'add',
  'reset',
  'revert',
  'stash',
  'branch',
  'pull',
]);

/**
 * Check if a git method should be blocked based on current mode.
 */
function shouldBlockGitMethod(method: string): boolean {
  if (GIT_REMOTE_METHODS.has(method)) {
    return true;
  }
  if (GIT_LOCAL_METHODS.has(method)) {
    return !isInWorktreeMode();
  }
  return false;
}

/**
 * Check if a git raw command should be blocked based on current mode.
 */
function shouldBlockGitRawCommand(command: string): boolean {
  if (GIT_RAW_REMOTE_COMMANDS.has(command)) {
    return true;
  }
  if (GIT_RAW_LOCAL_COMMANDS.has(command)) {
    return !isInWorktreeMode();
  }
  return false;
}

// WeakMap to cache wrapped git instances
const gitProxyCache = new WeakMap<SimpleGit, SimpleGit>();

/**
 * Mock results for git methods that return data structures consumers access.
 */
const GIT_MOCK_RESULTS: Record<string, unknown> = {
  commit: {
    commit: 'dry-run-commit-hash',
    author: null,
    branch: '',
    root: false,
    summary: { changes: 0, insertions: 0, deletions: 0 },
  },
};

/**
 * Creates a dry-run-aware wrapper around a SimpleGit instance.
 *
 * Mutating operations (push, commit, checkout, etc.) are automatically
 * blocked and logged when isDryRun() returns true.
 *
 * @param git The base SimpleGit instance to wrap
 * @returns A proxied SimpleGit that respects dry-run mode
 */
export function createDryRunGit(git: SimpleGit): SimpleGit {
  const cached = gitProxyCache.get(git);
  if (cached) {
    return cached;
  }

  const proxy = new Proxy(git, {
    get(target, prop: string) {
      const value = target[prop as keyof SimpleGit];

      if (typeof value !== 'function') {
        return value;
      }

      if (prop === 'raw') {
        return function (...args: string[]) {
          const command = args[0];
          if (isDryRun() && shouldBlockGitRawCommand(command)) {
            logDryRun(`git ${args.join(' ')}`);
            return Promise.resolve('');
          }
          return value.apply(target, args);
        };
      }

      if (isDryRun() && shouldBlockGitMethod(prop)) {
        return function (...args: unknown[]) {
          const argsStr = args
            .map(a => (typeof a === 'string' ? a : JSON.stringify(a)))
            .join(' ');
          logDryRun(`git.${prop}(${argsStr})`);
          const mockResult = GIT_MOCK_RESULTS[prop];
          if (mockResult) {
            return Promise.resolve(mockResult);
          }
          return proxy;
        };
      }

      return value.bind(target);
    },
  });

  gitProxyCache.set(git, proxy);
  return proxy;
}

// ============================================================================
// Octokit (GitHub API) Proxy
// ============================================================================

/**
 * GitHub API method prefixes that indicate mutating operations.
 */
const GITHUB_MUTATING_PREFIXES = [
  'create',
  'update',
  'delete',
  'upload',
  'remove',
  'add',
  'set',
  'merge',
];

/**
 * Check if a GitHub API method name indicates a mutating operation.
 */
function isGitHubMutatingMethod(methodName: string): boolean {
  return GITHUB_MUTATING_PREFIXES.some(prefix =>
    methodName.toLowerCase().startsWith(prefix.toLowerCase())
  );
}

/**
 * Creates a recursive proxy that intercepts GitHub API calls.
 */
function createGitHubNamespaceProxy(
  target: Record<string, unknown>,
  path: string[] = []
): Record<string, unknown> {
  return new Proxy(target, {
    get(obj, prop: string) {
      const value = obj[prop];

      if (value === undefined || typeof prop === 'symbol') {
        return value;
      }

      const currentPath = [...path, prop];

      if (typeof value === 'function') {
        return function (...args: unknown[]) {
          if (isDryRun() && isGitHubMutatingMethod(prop)) {
            const pathStr = currentPath.join('.');
            logDryRun(`github.${pathStr}(...)`);
            return Promise.resolve({ data: {}, status: 0 });
          }
          return (value as (...a: unknown[]) => unknown).apply(obj, args);
        };
      }

      if (typeof value === 'object' && value !== null) {
        return createGitHubNamespaceProxy(
          value as Record<string, unknown>,
          currentPath
        );
      }

      return value;
    },
  });
}

/**
 * Creates a dry-run-aware wrapper around an Octokit instance.
 *
 * Mutating API calls (create*, update*, delete*, upload*) are automatically
 * blocked and logged when isDryRun() returns true.
 *
 * @param octokit The base Octokit instance to wrap
 * @returns A proxied Octokit that respects dry-run mode
 */
export function createDryRunOctokit(octokit: Octokit): Octokit {
  return createGitHubNamespaceProxy(
    octokit as unknown as Record<string, unknown>
  ) as unknown as Octokit;
}

// ============================================================================
// File System Operations
// ============================================================================

/**
 * File system methods that modify state and should be blocked in dry-run mode.
 */
const FS_MUTATING_METHODS: Record<string, number> = {
  writeFile: 1,
  writeFileSync: 1,
  unlink: 1,
  unlinkSync: 1,
  rm: 1,
  rmSync: 1,
  rmdir: 1,
  rmdirSync: 1,
  mkdir: 1,
  mkdirSync: 1,
  appendFile: 1,
  appendFileSync: 1,
  chmod: 1,
  chmodSync: 1,
  chown: 1,
  chownSync: 1,
  truncate: 1,
  truncateSync: 1,
  rename: 2,
  renameSync: 2,
  copyFile: 2,
  copyFileSync: 2,
  symlink: 2,
  symlinkSync: 2,
  link: 2,
  linkSync: 2,
};

/**
 * Creates a proxy handler for file system modules.
 */
function createFsProxyHandler(
  isAsync: boolean
): ProxyHandler<typeof fs | typeof fsPromises> {
  return {
    get(target, prop: string) {
      const value = target[prop as keyof typeof target];

      if (typeof value !== 'function') {
        return value;
      }

      const pathArgCount = FS_MUTATING_METHODS[prop];
      if (pathArgCount !== undefined) {
        return function (...args: unknown[]) {
          if (isDryRun() && !isInWorktreeMode()) {
            const paths = args.slice(0, pathArgCount).join(', ');
            logDryRun(`fs.${prop}(${paths})`);
            return isAsync ? Promise.resolve(undefined) : undefined;
          }
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      }

      return (value as (...a: unknown[]) => unknown).bind(target);
    },
  };
}

/**
 * Dry-run-aware file system operations (async).
 */
export const safeFsPromises = new Proxy(
  fsPromises,
  createFsProxyHandler(true)
) as typeof fsPromises;

/**
 * Dry-run-aware file system operations (sync).
 */
export const safeFsSync = new Proxy(
  fs,
  createFsProxyHandler(false)
) as typeof fs;

/**
 * Convenience object that provides the most commonly used fs operations.
 */
export const safeFs = {
  writeFile: safeFsPromises.writeFile.bind(safeFsPromises),
  unlink: safeFsPromises.unlink.bind(safeFsPromises),
  rename: safeFsPromises.rename.bind(safeFsPromises),
  rm: safeFsPromises.rm.bind(safeFsPromises),
  mkdir: safeFsPromises.mkdir.bind(safeFsPromises),
  appendFile: safeFsPromises.appendFile.bind(safeFsPromises),
  copyFile: safeFsPromises.copyFile.bind(safeFsPromises),

  writeFileSync: safeFsSync.writeFileSync.bind(safeFsSync),
  unlinkSync: safeFsSync.unlinkSync.bind(safeFsSync),
  renameSync: safeFsSync.renameSync.bind(safeFsSync),
  rmSync: safeFsSync.rmSync.bind(safeFsSync),
  mkdirSync: safeFsSync.mkdirSync.bind(safeFsSync),
  appendFileSync: safeFsSync.appendFileSync.bind(safeFsSync),
  copyFileSync: safeFsSync.copyFileSync.bind(safeFsSync),
};

// ============================================================================
// Generic Action Wrapper
// ============================================================================

/**
 * Execute an action only if not in dry-run mode, or if in worktree mode.
 *
 * @param action The action to execute
 * @param description Human-readable description for dry-run logging
 * @returns The result of the action, or undefined in strict dry-run mode
 */
export async function safeExec<T>(
  action: () => Promise<T>,
  description: string
): Promise<T | undefined> {
  if (isDryRun() && !isInWorktreeMode()) {
    logDryRun(description);
    return undefined;
  }
  return action();
}

/**
 * Execute a synchronous action only if not in dry-run mode, or if in worktree mode.
 *
 * @param action The action to execute
 * @param description Human-readable description for dry-run logging
 * @returns The result of the action, or undefined in strict dry-run mode
 */
export function safeExecSync<T>(
  action: () => T,
  description: string
): T | undefined {
  if (isDryRun() && !isInWorktreeMode()) {
    logDryRun(description);
    return undefined;
  }
  return action();
}
