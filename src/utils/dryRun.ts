/**
 * Dry-run abstraction layer for destructive operations.
 *
 * This module provides Proxy-wrapped versions of external libraries/APIs that
 * automatically respect the --dry-run flag. Instead of checking isDryRun() in
 * every function, use these wrapped versions which intercept mutating operations.
 */
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import type { SimpleGit } from 'simple-git';
import type { Octokit } from '@octokit/rest';

import { logger } from '../logger';
import { isDryRun } from './helpers';

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
 * Git methods that modify state and should be blocked in dry-run mode.
 */
const GIT_MUTATING_METHODS = new Set([
  'push',
  'commit',
  'checkout',
  'checkoutBranch',
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
 * Git raw commands that modify state and should be blocked in dry-run mode.
 */
const GIT_RAW_MUTATING_COMMANDS = new Set([
  'push',
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
  // Note: 'clone' is intentionally NOT included - it creates a local copy
  // which is safe to do in dry-run mode and needed for subsequent operations
]);

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
  return new Proxy(git, {
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
          if (isDryRun() && GIT_RAW_MUTATING_COMMANDS.has(command)) {
            logDryRun(`git ${args.join(' ')}`);
            // Return a resolved promise for async compatibility
            return Promise.resolve('');
          }
          return value.apply(target, args);
        };
      }

      // Check if this is a mutating method
      if (GIT_MUTATING_METHODS.has(prop)) {
        return function (...args: unknown[]) {
          if (isDryRun()) {
            const argsStr = args
              .map(a => (typeof a === 'string' ? a : JSON.stringify(a)))
              .join(' ');
            logDryRun(`git.${prop}(${argsStr})`);
            // Return a resolved promise for async compatibility
            // Some git methods return the git instance for chaining
            return Promise.resolve(createDryRunGit(target));
          }
          return value.apply(target, args);
        };
      }

      // For non-mutating methods, bind and return
      return value.bind(target);
    },
  });
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
 * Dry-run-aware file system operations.
 *
 * Write operations are blocked and logged in dry-run mode.
 * Read operations always execute normally.
 */
export const safeFs = {
  /**
   * Write data to a file asynchronously.
   */
  writeFile: async (
    filePath: string,
    data: string | Buffer,
    options?: fs.WriteFileOptions
  ): Promise<void> => {
    if (isDryRun()) {
      logDryRun(`fs.writeFile(${filePath})`);
      return;
    }
    return fsPromises.writeFile(filePath, data, options);
  },

  /**
   * Write data to a file synchronously.
   */
  writeFileSync: (
    filePath: string,
    data: string | Buffer,
    options?: fs.WriteFileOptions
  ): void => {
    if (isDryRun()) {
      logDryRun(`fs.writeFileSync(${filePath})`);
      return;
    }
    return fs.writeFileSync(filePath, data, options);
  },

  /**
   * Delete a file asynchronously.
   */
  unlink: async (filePath: string): Promise<void> => {
    if (isDryRun()) {
      logDryRun(`fs.unlink(${filePath})`);
      return;
    }
    return fsPromises.unlink(filePath);
  },

  /**
   * Delete a file synchronously.
   */
  unlinkSync: (filePath: string): void => {
    if (isDryRun()) {
      logDryRun(`fs.unlinkSync(${filePath})`);
      return;
    }
    return fs.unlinkSync(filePath);
  },

  /**
   * Rename a file asynchronously.
   */
  rename: async (oldPath: string, newPath: string): Promise<void> => {
    if (isDryRun()) {
      logDryRun(`fs.rename(${oldPath}, ${newPath})`);
      return;
    }
    return fsPromises.rename(oldPath, newPath);
  },

  /**
   * Rename a file synchronously.
   */
  renameSync: (oldPath: string, newPath: string): void => {
    if (isDryRun()) {
      logDryRun(`fs.renameSync(${oldPath}, ${newPath})`);
      return;
    }
    return fs.renameSync(oldPath, newPath);
  },

  /**
   * Remove a directory recursively asynchronously.
   */
  rm: async (
    filePath: string,
    options?: fs.RmOptions
  ): Promise<void> => {
    if (isDryRun()) {
      logDryRun(`fs.rm(${filePath})`);
      return;
    }
    return fsPromises.rm(filePath, options);
  },

  /**
   * Remove a directory recursively synchronously.
   */
  rmSync: (filePath: string, options?: fs.RmOptions): void => {
    if (isDryRun()) {
      logDryRun(`fs.rmSync(${filePath})`);
      return;
    }
    return fs.rmSync(filePath, options);
  },

  /**
   * Create a directory asynchronously.
   */
  mkdir: async (
    dirPath: string,
    options?: fs.MakeDirectoryOptions
  ): Promise<string | undefined> => {
    if (isDryRun()) {
      logDryRun(`fs.mkdir(${dirPath})`);
      return undefined;
    }
    return fsPromises.mkdir(dirPath, options);
  },

  /**
   * Create a directory synchronously.
   */
  mkdirSync: (
    dirPath: string,
    options?: fs.MakeDirectoryOptions
  ): string | undefined => {
    if (isDryRun()) {
      logDryRun(`fs.mkdirSync(${dirPath})`);
      return undefined;
    }
    return fs.mkdirSync(dirPath, options);
  },

  /**
   * Append data to a file asynchronously.
   */
  appendFile: async (
    filePath: string,
    data: string | Buffer,
    options?: fs.WriteFileOptions
  ): Promise<void> => {
    if (isDryRun()) {
      logDryRun(`fs.appendFile(${filePath})`);
      return;
    }
    return fsPromises.appendFile(filePath, data, options);
  },

  /**
   * Append data to a file synchronously.
   */
  appendFileSync: (
    filePath: string,
    data: string | Buffer,
    options?: fs.WriteFileOptions
  ): void => {
    if (isDryRun()) {
      logDryRun(`fs.appendFileSync(${filePath})`);
      return;
    }
    return fs.appendFileSync(filePath, data, options);
  },
};

// ============================================================================
// Generic Action Wrapper
// ============================================================================

/**
 * Execute an action only if not in dry-run mode.
 *
 * This is useful for wrapping arbitrary async operations that don't fit
 * into the git/github/fs categories.
 *
 * @param action The action to execute
 * @param description Human-readable description for dry-run logging
 * @returns The result of the action, or undefined in dry-run mode
 */
export async function safeExec<T>(
  action: () => Promise<T>,
  description: string
): Promise<T | undefined> {
  if (isDryRun()) {
    logDryRun(description);
    return undefined;
  }
  return action();
}

/**
 * Execute a synchronous action only if not in dry-run mode.
 *
 * @param action The action to execute
 * @param description Human-readable description for dry-run logging
 * @returns The result of the action, or undefined in dry-run mode
 */
export function safeExecSync<T>(
  action: () => T,
  description: string
): T | undefined {
  if (isDryRun()) {
    logDryRun(description);
    return undefined;
  }
  return action();
}
