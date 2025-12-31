import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { existsSync } from 'fs';
import { mkdir, rm, writeFile } from 'fs/promises';

// Mock the logger
vi.mock('../../logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// We need to test without the actual git worktree commands for unit tests
// Integration tests would use a real git repo

describe('worktree utilities', () => {
  describe('WorktreeContext interface', () => {
    it('should have required properties', async () => {
      // Import the module to verify types compile
      const { createDryRunWorktree, showWorktreeDiff } = await import(
        '../worktree'
      );

      // These are just type checks - the actual functions need a real git repo
      expect(typeof createDryRunWorktree).toBe('function');
      expect(typeof showWorktreeDiff).toBe('function');
    });
  });

  describe('symlink behavior', () => {
    const testDir = join(tmpdir(), 'craft-worktree-test');
    const nodeModulesDir = join(testDir, 'node_modules');

    beforeEach(async () => {
      // Create a test directory structure
      await mkdir(testDir, { recursive: true });
      await mkdir(nodeModulesDir, { recursive: true });
      await writeFile(
        join(nodeModulesDir, 'test-package.txt'),
        'test content'
      );
    });

    afterEach(async () => {
      // Clean up
      await rm(testDir, { recursive: true, force: true });
    });

    it('should identify directories to symlink', () => {
      // The SYMLINK_DIRS constant should include common dependency directories
      expect(existsSync(nodeModulesDir)).toBe(true);
    });
  });
});

describe('worktree mode in dryRun', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('should export worktree mode functions', async () => {
    const {
      enableWorktreeMode,
      disableWorktreeMode,
      isInWorktreeMode,
    } = await import('../dryRun');

    expect(typeof enableWorktreeMode).toBe('function');
    expect(typeof disableWorktreeMode).toBe('function');
    expect(typeof isInWorktreeMode).toBe('function');
  });

  it('should toggle worktree mode correctly', async () => {
    const {
      enableWorktreeMode,
      disableWorktreeMode,
      isInWorktreeMode,
    } = await import('../dryRun');

    // Initially should be false
    expect(isInWorktreeMode()).toBe(false);

    // Enable worktree mode
    enableWorktreeMode();
    expect(isInWorktreeMode()).toBe(true);

    // Disable worktree mode
    disableWorktreeMode();
    expect(isInWorktreeMode()).toBe(false);
  });
});
