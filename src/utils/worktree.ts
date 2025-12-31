/**
 * Git worktree utilities for dry-run mode.
 *
 * In dry-run mode, we create a temporary worktree where all local operations
 * (branch creation, commits, file writes) can execute normally. This provides
 * a real preview of what would happen without affecting the user's working directory.
 */
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { existsSync, symlinkSync, lstatSync } from 'fs';
import { rm } from 'fs/promises';

import simpleGit, { type SimpleGit } from 'simple-git';

import { logger } from '../logger';

// Track active worktree for cleanup on unexpected exit
let _activeWorktreeCleanup: (() => Promise<void>) | null = null;

/**
 * Register signal handlers for cleanup on Ctrl+C or unexpected exit.
 * This ensures the worktree is cleaned up even if the process is interrupted.
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

  // Handle Ctrl+C (SIGINT) and termination (SIGTERM)
  process.once('SIGINT', () => handleSignal('SIGINT'));
  process.once('SIGTERM', () => handleSignal('SIGTERM'));
}

/**
 * Unregister cleanup handlers after normal cleanup.
 */
function unregisterCleanupHandlers(): void {
  _activeWorktreeCleanup = null;
  // Remove listeners to avoid memory leaks
  process.removeAllListeners('SIGINT');
  process.removeAllListeners('SIGTERM');
}

/**
 * Context for a dry-run worktree session.
 */
export interface WorktreeContext {
  /** Path to the temporary worktree directory */
  worktreePath: string;
  /** Original working directory before switching to worktree */
  originalCwd: string;
  /** Original HEAD commit SHA */
  originalHead: string;
  /** Cleanup function to remove the worktree */
  cleanup: () => Promise<void>;
}

/**
 * Directories that should be symlinked from the original repo to the worktree.
 * These are typically large dependency directories that don't need to be copied.
 */
const SYMLINK_DIRS = [
  'node_modules',
  'vendor',
  '.venv',
  'venv',
  '__pycache__',
  '.gradle',
  'build',
  'target', // Rust/Maven
  'Pods', // iOS
];

/**
 * Creates a temporary git worktree for dry-run operations.
 *
 * The worktree is created from the specified revision and allows all local
 * git operations (branch creation, commits, file writes) while keeping the
 * user's original working directory untouched.
 *
 * @param git Git client for the original repository
 * @param rev Revision to base the worktree on (defaults to HEAD)
 * @returns WorktreeContext with path and cleanup function
 */
export async function createDryRunWorktree(
  git: SimpleGit,
  rev?: string
): Promise<WorktreeContext> {
  const originalCwd = process.cwd();
  const originalHead = (await git.revparse(['HEAD'])).trim();
  const revision = rev || originalHead;

  // Generate a unique temp directory name
  const randomSuffix = randomBytes(8).toString('hex');
  const worktreePath = join(tmpdir(), `craft-dry-run-${randomSuffix}`);

  logger.info(`[dry-run] Creating temporary worktree at ${worktreePath}`);

  // Create the worktree using raw git (not the dry-run proxy)
  // eslint-disable-next-line no-restricted-syntax -- Need raw git for worktree creation
  const rawGit = simpleGit(originalCwd);
  await rawGit.raw(['worktree', 'add', '--detach', worktreePath, revision]);

  // Symlink large directories that don't need to be in the worktree
  symlinkDependencyDirs(originalCwd, worktreePath);

  const cleanup = async (): Promise<void> => {
    logger.debug(`[dry-run] Cleaning up temporary worktree at ${worktreePath}`);
    // Unregister signal handlers first
    unregisterCleanupHandlers();
    try {
      // Remove the worktree registration from git
      // eslint-disable-next-line no-restricted-syntax -- Need raw git for worktree removal
      const cleanupGit = simpleGit(originalCwd);
      await cleanupGit.raw(['worktree', 'remove', '--force', worktreePath]);
    } catch (err) {
      // If git worktree remove fails, try to clean up manually
      logger.debug(
        `[dry-run] Git worktree remove failed, cleaning up manually: ${err}`
      );
      try {
        await rm(worktreePath, { recursive: true, force: true });
        // Also prune worktrees to clean up the reference
        // eslint-disable-next-line no-restricted-syntax -- Need raw git for worktree prune
        const pruneGit = simpleGit(originalCwd);
        await pruneGit.raw(['worktree', 'prune']);
      } catch (rmErr) {
        logger.warn(`[dry-run] Failed to clean up worktree: ${rmErr}`);
      }
    }
  };

  // Register signal handlers for cleanup on Ctrl+C
  registerCleanupHandlers(cleanup);

  return {
    worktreePath,
    originalCwd,
    originalHead,
    cleanup,
  };
}

/**
 * Symlinks dependency directories from the original repo to the worktree.
 * This avoids copying large directories like node_modules.
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
        // Symlink might fail if dest already exists or on Windows
        logger.debug(`[dry-run] Could not symlink ${dir}: ${err}`);
      }
    }
  }
}

/**
 * Shows a formatted diff between the worktree changes and the original state.
 *
 * @param worktreePath Path to the worktree
 * @param originalHead Original HEAD commit to diff against
 */
export async function showWorktreeDiff(
  worktreePath: string,
  originalHead: string
): Promise<void> {
  // eslint-disable-next-line no-restricted-syntax -- Need raw git for diff
  const git = simpleGit(worktreePath);

  // Get the current HEAD in the worktree
  const worktreeHead = (await git.revparse(['HEAD'])).trim();

  // Get the list of changed files
  const diffSummary = await git.diffSummary([originalHead, worktreeHead]);

  if (diffSummary.files.length === 0) {
    logger.info('\n[dry-run] No changes would be made.');
    return;
  }

  // Print header
  console.log('\n' + '━'.repeat(70));
  console.log(' Dry-run complete. Here\'s what would change:');
  console.log('━'.repeat(70) + '\n');

  // Print file summary
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

  // Get and print the actual diff
  const diff = await git.diff([originalHead, worktreeHead, '--color=always']);
  if (diff) {
    console.log(diff);
  }

  console.log('━'.repeat(70));
  console.log('[dry-run] No actual changes were made to your repository.');
  console.log('━'.repeat(70) + '\n');
}

/**
 * Gets the commit message from the worktree HEAD.
 *
 * @param worktreePath Path to the worktree
 * @returns The commit message of the worktree HEAD
 */
export async function getWorktreeCommitMessage(
  worktreePath: string
): Promise<string> {
  // eslint-disable-next-line no-restricted-syntax -- Need raw git
  const git = simpleGit(worktreePath);
  return (await git.raw(['log', '-1', '--format=%B'])).trim();
}
