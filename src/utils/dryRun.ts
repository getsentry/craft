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
 */
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import type { SimpleGit } from 'simple-git';
import type { Octokit } from '@octokit/rest';

import { logger } from '../logger';
import { isDryRun } from './helpers';

// ============================================================================
// Worktree Mode Context
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
 */
export function enableWorktreeMode(): void {
  _inWorktreeMode = true;
  logger.debug('[dry-run] Worktree mode enabled - local operations allowed');
}

/**
 * Disable worktree mode and return to strict dry-run.
 */
export function disableWorktreeMode(): void {
  _inWorktreeMode = false;
  logger.debug('[dry-run] Worktree mode disabled');
}

/**
 * Check if we're currently in worktree mode.
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
// Git Proxy
// ============================================================================

/**
 * Git methods that affect remote state and should ALWAYS be blocked in dry-run.
 * These are the "point of no return" operations.
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
  // Note: 'clone' is intentionally NOT included - it creates a local copy
  // which is safe to do in dry-run mode and needed for subsequent operations
]);

/**
 * Git raw commands that affect remote state - always blocked.
 */
const GIT_RAW_REMOTE_COMMANDS = new Set(['push']);

/**
 * Git raw commands that modify local state only.
 * Blocked in strict dry-run, but allowed in worktree mode.
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
  // Note: 'clone' is intentionally NOT included
]);

/**
 * Check if a git method should be blocked based on current mode.
 */
function shouldBlockGitMethod(method: string): boolean {
  // Remote methods are always blocked in dry-run
  if (GIT_REMOTE_METHODS.has(method)) {
    return true;
  }
  // Local methods are only blocked in strict mode (not in worktree mode)
  if (GIT_LOCAL_METHODS.has(method)) {
    return !isInWorktreeMode();
  }
  return false;
}

/**
 * Check if a git raw command should be blocked based on current mode.
 */
function shouldBlockGitRawCommand(command: string): boolean {
  // Remote commands are always blocked in dry-run
  if (GIT_RAW_REMOTE_COMMANDS.has(command)) {
    return true;
  }
  // Local commands are only blocked in strict mode (not in worktree mode)
  if (GIT_RAW_LOCAL_COMMANDS.has(command)) {
    return !isInWorktreeMode();
  }
  return false;
}

// WeakMap to cache wrapped git instances, avoiding recreation on chaining
const gitProxyCache = new WeakMap<SimpleGit, SimpleGit>();

/**
 * Mock results for git methods that return data structures consumers access.
 * Methods not listed here will return the proxy for chaining compatibility.
 *
 * IMPORTANT: Only add methods here if their return value properties are actually
 * accessed in the codebase. Methods used in chains (like pull, push, branch)
 * should NOT be listed here, as returning a mock object breaks chaining.
 */
const GIT_MOCK_RESULTS: Record<string, unknown> = {
  // commit: Used in upm.ts where commitResult.commit is accessed
  commit: {
    commit: 'dry-run-commit-hash',
    author: null,
    branch: '',
    root: false,
    summary: { changes: 0, insertions: 0, deletions: 0 },
  },
  // NOTE: pull and push are intentionally NOT included here because they are
  // used in method chains like git.pull().merge().push() in publish.ts
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
  // Return cached proxy if we've already wrapped this instance
  const cached = gitProxyCache.get(git);
  if (cached) {
    return cached;
  }

  const proxy = new Proxy(git, {
    get(target, prop: string) {
      const value = target[prop as keyof SimpleGit];

      // If it's not a function, return as-is
      if (typeof value !== 'function') {
        return value;
      }

      // Handle the special 'raw' method
      if (prop === 'raw') {
        return function (...args: string[]) {
          const command = args[0];
          if (isDryRun() && shouldBlockGitRawCommand(command)) {
            logDryRun(`git ${args.join(' ')}`);
            // Return a resolved promise for async compatibility
            return Promise.resolve('');
          }
          return value.apply(target, args);
        };
      }

      // Check if this method should be blocked
      if (isDryRun() && shouldBlockGitMethod(prop)) {
        return function (...args: unknown[]) {
          const argsStr = args
            .map(a => (typeof a === 'string' ? a : JSON.stringify(a)))
            .join(' ');
          logDryRun(`git.${prop}(${argsStr})`);
          // Return a mock result if the method's return value is accessed,
          // otherwise return the proxy directly for chaining compatibility.
          // SimpleGit is thenable, so `await proxy` works correctly.
          const mockResult = GIT_MOCK_RESULTS[prop];
          if (mockResult) {
            return Promise.resolve(mockResult);
          }
          // Return proxy directly (not wrapped in Promise) to support
          // chaining like git.pull().merge().push()
          return proxy;
        };
      }

      // For non-mutating methods, bind and return
      return value.bind(target);
    },
  });

  // Cache the proxy for this git instance
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
 * Handles nested namespaces like github.repos.createRelease().
 */
function createGitHubNamespaceProxy(
  target: Record<string, unknown>,
  path: string[] = []
): Record<string, unknown> {
  return new Proxy(target, {
    get(obj, prop: string) {
      const value = obj[prop];

      // Skip non-existent properties and symbols
      if (value === undefined || typeof prop === 'symbol') {
        return value;
      }

      const currentPath = [...path, prop];

      // If it's a function, potentially intercept it
      if (typeof value === 'function') {
        return function (...args: unknown[]) {
          if (isDryRun() && isGitHubMutatingMethod(prop)) {
            const pathStr = currentPath.join('.');
            logDryRun(`github.${pathStr}(...)`);
            // Return a mock response for compatibility
            // status: 0 ensures status-based checks (e.g., === 204) fail gracefully
            return Promise.resolve({ data: {}, status: 0 });
          }
          return (value as (...a: unknown[]) => unknown).apply(obj, args);
        };
      }

      // If it's an object (namespace), recursively proxy it
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
 * Maps method names to the number of path arguments to include in the log.
 */
const FS_MUTATING_METHODS: Record<string, number> = {
  // Single path methods
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
  // Two path methods (source, dest)
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
 * Intercepts mutating operations and blocks them in dry-run mode.
 * In worktree mode, file operations are allowed since they happen in temp dir.
 */
function createFsProxyHandler(
  isAsync: boolean
): ProxyHandler<typeof fs | typeof fsPromises> {
  return {
    get(target, prop: string) {
      const value = target[prop as keyof typeof target];

      // If it's not a function, return as-is
      if (typeof value !== 'function') {
        return value;
      }

      // Check if this is a mutating method
      const pathArgCount = FS_MUTATING_METHODS[prop];
      if (pathArgCount !== undefined) {
        return function (...args: unknown[]) {
          // In worktree mode, allow file operations (they're in temp dir)
          // In strict mode, block and log
          if (isDryRun() && !isInWorktreeMode()) {
            const paths = args.slice(0, pathArgCount).join(', ');
            logDryRun(`fs.${prop}(${paths})`);
            // Return appropriate value for async vs sync
            return isAsync ? Promise.resolve(undefined) : undefined;
          }
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      }

      // For non-mutating methods, bind and return
      return (value as (...a: unknown[]) => unknown).bind(target);
    },
  };
}

/**
 * Dry-run-aware file system operations (async).
 *
 * Write operations are blocked and logged in dry-run mode.
 * Read operations always execute normally.
 */
export const safeFsPromises = new Proxy(
  fsPromises,
  createFsProxyHandler(true)
) as typeof fsPromises;

/**
 * Dry-run-aware file system operations (sync).
 *
 * Write operations are blocked and logged in dry-run mode.
 * Read operations always execute normally.
 */
export const safeFsSync = new Proxy(
  fs,
  createFsProxyHandler(false)
) as typeof fs;

/**
 * Convenience object that provides the most commonly used fs operations.
 * Combines async and sync methods in one object for backwards compatibility.
 */
export const safeFs = {
  // Async methods (from fs/promises)
  writeFile: safeFsPromises.writeFile.bind(safeFsPromises),
  unlink: safeFsPromises.unlink.bind(safeFsPromises),
  rename: safeFsPromises.rename.bind(safeFsPromises),
  rm: safeFsPromises.rm.bind(safeFsPromises),
  mkdir: safeFsPromises.mkdir.bind(safeFsPromises),
  appendFile: safeFsPromises.appendFile.bind(safeFsPromises),
  copyFile: safeFsPromises.copyFile.bind(safeFsPromises),

  // Sync methods (from fs)
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
 * This is useful for wrapping arbitrary async operations that don't fit
 * into the git/github/fs categories. In worktree mode, commands are allowed
 * to execute because they run in an isolated temporary worktree.
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
 * In worktree mode, commands are allowed to execute because they run in an
 * isolated temporary worktree.
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
