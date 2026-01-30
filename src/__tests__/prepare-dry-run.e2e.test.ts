/**
 * E2E tests for `craft prepare --dry-run` with worktree mode.
 *
 * These tests verify that:
 * 1. Dry-run creates a worktree for isolated operations
 * 2. Original repository working directory is not modified
 * 3. Worktree is cleaned up after execution
 */
import { describe, test, expect, afterEach, beforeAll } from 'vitest';
import { execFile, execSync } from 'child_process';
import { promisify } from 'util';
import { resolve, join } from 'path';
import { mkdtemp, rm, writeFile, readFile, mkdir, chmod } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
// eslint-disable-next-line no-restricted-imports, no-restricted-syntax -- Test file needs direct git access for setup/verification
import simpleGit from 'simple-git';

const execFileAsync = promisify(execFile);

// Path to the built CLI binary - e2e tests use the actual artifact
const CLI_BIN = resolve(__dirname, '../../dist/craft');

// Ensure the binary is built before running e2e tests
beforeAll(() => {
  if (!existsSync(CLI_BIN)) {
    console.log('Building craft binary for e2e tests...');
    execSync('pnpm build', {
      cwd: resolve(__dirname, '../..'),
      stdio: 'inherit',
    });
  }
}, 60000);

/**
 * Creates a test git repository with:
 * - Initial commit
 * - A tag (1.0.0)
 * - .craft.yml configuration
 * - CHANGELOG.md file
 */
async function createTestRepo(): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), 'craft-e2e-'));
  // eslint-disable-next-line no-restricted-syntax -- Test setup needs direct git access
  const git = simpleGit(tempDir);

  // Initialize git repo
  await git.init();
  await git.addConfig('user.email', 'test@example.com');
  await git.addConfig('user.name', 'Test User');

  // Create .craft.yml with explicit GitHub config
  const craftConfig = `
minVersion: "2.0.0"
github:
  owner: test-owner
  repo: test-repo
changelog:
  policy: none
preReleaseCommand: ""
targets: []
`;
  await writeFile(join(tempDir, '.craft.yml'), craftConfig);

  // Create CHANGELOG.md
  const changelog = `# Changelog

## 1.0.0

- Initial release
`;
  await writeFile(join(tempDir, 'CHANGELOG.md'), changelog);

  // Create package.json for version tracking
  const packageJson = {
    name: 'test-package',
    version: '1.0.0',
  };
  await writeFile(
    join(tempDir, 'package.json'),
    JSON.stringify(packageJson, null, 2),
  );

  // Initial commit and tag
  await git.add('.');
  await git.commit('Initial commit');
  await git.addTag('1.0.0');

  // Add a feature commit
  await writeFile(join(tempDir, 'feature.ts'), 'export const foo = 1;');
  await git.add('.');
  await git.commit('feat: Add foo feature');

  // Add a fix commit
  await writeFile(join(tempDir, 'fix.ts'), 'export const bar = 2;');
  await git.add('.');
  await git.commit('fix: Fix bar issue');

  // Create a bare remote repo to satisfy git remote operations
  const remoteDir = await mkdtemp(join(tmpdir(), 'craft-e2e-remote-'));
  // eslint-disable-next-line no-restricted-syntax -- Test setup needs direct git access
  const remoteGit = simpleGit(remoteDir);
  await remoteGit.init(true); // bare repo
  await git.addRemote('origin', remoteDir);
  // Push the main branch to set up tracking
  const status = await git.status();
  await git.push('origin', status.current!, ['--set-upstream']);

  return tempDir;
}

/**
 * Normalizes output for snapshot comparison.
 * Removes dynamic parts like commit hashes, timestamps, and paths.
 */
function normalizeOutput(output: string): string {
  return (
    output
      // Remove ANSI color codes
      // eslint-disable-next-line no-control-regex -- Need to match ANSI escape sequences
      .replace(/\x1b\[[0-9;]*m/g, '')
      // Remove node deprecation warnings (must be before hash normalization)
      .replace(/\(node:\d+\)[^\n]*DeprecationWarning[^\n]*\n?/g, '')
      .replace(/\(node:\d+\)[^\n]*\n/g, '')
      .replace(/\(Use `node --trace-warnings.*\n/g, '')
      .replace(/\(Use `node --trace-deprecation.*\n/g, '')
      .replace(/Support for loading ES Module.*\n/g, '')
      // Normalize temp directory paths
      .replace(/\/tmp\/craft-[a-z0-9-]+/g, '/tmp/craft-XXXXX')
      // Normalize commit hashes (7-40 hex chars)
      .replace(/\b[a-f0-9]{7,40}\b/g, 'HASH')
      // Normalize index lines in diffs
      .replace(/index [a-f0-9]+\.\.[a-f0-9]+/g, 'index HASH..HASH')
      // Normalize worktree paths in messages
      .replace(/craft-dry-run-[a-f0-9]+/g, 'craft-dry-run-XXXXX')
      // Normalize line counts that might vary
      .replace(/@@ -\d+,\d+ \+\d+,\d+ @@/g, '@@ -X,Y +X,Y @@')
      // Normalize PID references
      .replace(/node:\d+/g, 'node:PID')
      // Normalize branch names (main vs master)
      .replace(/from (main|master)/g, 'from DEFAULT_BRANCH')
  );
}

describe('prepare --dry-run e2e', () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test('creates worktree, operates within it, and cleans up', async () => {
    tempDir = await createTestRepo();
    // eslint-disable-next-line no-restricted-syntax -- Test verification needs direct git access
    const git = simpleGit(tempDir);

    // Get state before
    const statusBefore = await git.status();
    const logBefore = await git.log();
    const packageJsonBefore = await readFile(
      join(tempDir, 'package.json'),
      'utf8',
    );
    const changelogBefore = await readFile(
      join(tempDir, 'CHANGELOG.md'),
      'utf8',
    );

    // Run prepare --dry-run
    const { stdout, stderr } = await execFileAsync(
      CLI_BIN,
      ['prepare', '1.0.1', '--dry-run', '--no-input'],
      {
        cwd: tempDir,
        env: {
          ...process.env,
          NODE_ENV: 'test',
          GITHUB_TOKEN: 'test-token',
        },
      },
    );

    const combinedOutput = stdout + stderr;

    // Verify worktree was created
    expect(combinedOutput).toContain('[dry-run] Creating temporary worktree');
    // Verify release branch was created in worktree
    expect(combinedOutput).toContain('release/1.0.1');
    // Verify push was blocked
    expect(combinedOutput).toContain('[dry-run] Would execute');
    expect(combinedOutput).toContain('git.push');

    // Verify original repo working directory is unchanged
    const statusAfter = await git.status();
    const logAfter = await git.log();
    const packageJsonAfter = await readFile(
      join(tempDir, 'package.json'),
      'utf8',
    );
    const changelogAfter = await readFile(
      join(tempDir, 'CHANGELOG.md'),
      'utf8',
    );

    // Same working directory status - no uncommitted changes
    expect(statusAfter.files).toEqual(statusBefore.files);
    // Same commit history in main branch
    expect(logAfter.total).toEqual(logBefore.total);
    // Files unchanged
    expect(packageJsonAfter).toEqual(packageJsonBefore);
    expect(changelogAfter).toEqual(changelogBefore);

    // Verify worktree is cleaned up (no leftover worktrees)
    const worktrees = await git.raw(['worktree', 'list']);
    const worktreeLines = worktrees.trim().split('\n');
    expect(worktreeLines.length).toBe(1); // Only the main worktree

    // Note: The release branch may still exist in refs because git worktrees
    // share the same object store. What matters is that the working directory
    // is unchanged and the worktree is cleaned up.
  }, 60000);

  test('produces consistent output format', async () => {
    tempDir = await createTestRepo();

    // Run prepare --dry-run
    const { stdout, stderr } = await execFileAsync(
      CLI_BIN,
      ['prepare', '1.0.1', '--dry-run', '--no-input'],
      {
        cwd: tempDir,
        env: {
          ...process.env,
          NODE_ENV: 'test',
          GITHUB_TOKEN: 'test-token',
        },
      },
    );

    const combinedOutput = stdout + stderr;

    // Verify expected messages appear in order
    expect(combinedOutput).toContain('Checking the local repository status');
    expect(combinedOutput).toContain('Releasing version 1.0.1');
    expect(combinedOutput).toContain('[dry-run] Creating temporary worktree');
    expect(combinedOutput).toContain('Created a new release branch');
    expect(combinedOutput).toContain('Pushing the release branch');
    expect(combinedOutput).toContain('[dry-run] Would execute');

    // Snapshot the normalized output
    const normalizedOutput = normalizeOutput(combinedOutput);
    expect(normalizedOutput).toMatchSnapshot('dry-run-output');
  }, 60000);

  test('executes pre-release command and shows diff of changes', async () => {
    tempDir = await createTestRepo();
    // eslint-disable-next-line no-restricted-syntax -- Test setup needs direct git access
    const git = simpleGit(tempDir);

    // Get the current branch name (could be 'main' or 'master')
    const status = await git.status();
    const currentBranch = status.current!;

    // Create a version bump script
    const scriptsDir = join(tempDir, 'scripts');
    await mkdir(scriptsDir, { recursive: true });
    const versionBumpScript = `#!/bin/bash
VERSION="$2"
# Update package.json version
sed -i 's/"version": "[^"]*"/"version": "'"$VERSION"'"/' package.json
`;
    const scriptPath = join(scriptsDir, 'bump-version.sh');
    await writeFile(scriptPath, versionBumpScript);
    await chmod(scriptPath, '755');

    // Update .craft.yml with pre-release command
    const craftConfig = `
minVersion: "2.0.0"
github:
  owner: test-owner
  repo: test-repo
changelog:
  policy: none
preReleaseCommand: bash scripts/bump-version.sh
targets: []
`;
    await writeFile(join(tempDir, '.craft.yml'), craftConfig);
    await git.add('.');
    await git.commit('Add version bump script');
    await git.push('origin', currentBranch);

    // Get original package.json
    const packageJsonBefore = await readFile(
      join(tempDir, 'package.json'),
      'utf8',
    );
    expect(packageJsonBefore).toContain('"version": "1.0.0"');

    // Run prepare --dry-run
    const { stdout, stderr } = await execFileAsync(
      CLI_BIN,
      ['prepare', '1.0.1', '--dry-run', '--no-input'],
      {
        cwd: tempDir,
        env: {
          ...process.env,
          NODE_ENV: 'test',
          GITHUB_TOKEN: 'test-token',
        },
      },
    );

    const combinedOutput = stdout + stderr;

    // Verify pre-release command ran (should show "Running the pre-release command")
    expect(combinedOutput).toContain('Running the pre-release command');
    // Should NOT say "Not spawning process" - the command should actually run
    expect(combinedOutput).not.toContain('[dry-run] Not spawning process');

    // Should show the diff with version change
    expect(combinedOutput).toContain("Here's what would change");
    expect(combinedOutput).toContain('package.json');

    // Original file should be unchanged
    const packageJsonAfter = await readFile(
      join(tempDir, 'package.json'),
      'utf8',
    );
    expect(packageJsonAfter).toEqual(packageJsonBefore);
    expect(packageJsonAfter).toContain('"version": "1.0.0"');

    // Snapshot the diff output
    const normalizedOutput = normalizeOutput(combinedOutput);
    expect(normalizedOutput).toMatchSnapshot('pre-release-diff');
  }, 60000);

  test('cleans up worktree even on error', async () => {
    tempDir = await createTestRepo();
    // eslint-disable-next-line no-restricted-syntax -- Test verification needs direct git access
    const git = simpleGit(tempDir);

    // Get the current branch name
    const status = await git.status();
    const currentBranch = status.current;

    // Create the release branch locally to cause a conflict in the worktree
    await git.checkoutLocalBranch('release/1.0.1');
    await git.checkout(currentBranch!);

    try {
      await execFileAsync(
        CLI_BIN,
        ['prepare', '1.0.1', '--dry-run', '--no-input'],
        {
          cwd: tempDir,
          env: {
            ...process.env,
            NODE_ENV: 'test',
            GITHUB_TOKEN: 'test-token',
          },
        },
      );
      // If it doesn't throw, that's also fine (branch might be reused)
    } catch {
      // Expected to fail due to existing branch
    }

    // Even after error, worktree should be cleaned up
    const worktrees = await git.raw(['worktree', 'list']);
    const worktreeLines = worktrees.trim().split('\n');
    expect(worktreeLines.length).toBe(1);
  }, 60000);

  test('accepts prepare command without version argument when versioning policy is set', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'craft-e2e-'));
    // eslint-disable-next-line no-restricted-syntax -- Test setup needs direct git access
    const git = simpleGit(tempDir);

    // Initialize git repo
    await git.init();
    await git.addConfig('user.email', 'test@example.com');
    await git.addConfig('user.name', 'Test User');

    // Create .craft.yml with auto versioning policy
    const craftConfig = `
minVersion: "2.14.0"
github:
  owner: test-owner
  repo: test-repo
versioning:
  policy: auto
changelog:
  policy: none
preReleaseCommand: ""
targets: []
`;
    await writeFile(join(tempDir, '.craft.yml'), craftConfig);

    // Create package.json
    const packageJson = { name: 'test-package', version: '1.0.0' };
    await writeFile(
      join(tempDir, 'package.json'),
      JSON.stringify(packageJson, null, 2),
    );

    // Initial commit and tag
    await git.add('.');
    await git.commit('Initial commit');
    await git.addTag('1.0.0');

    // Add a feature commit (for auto version detection)
    await writeFile(join(tempDir, 'feature.ts'), 'export const foo = 1;');
    await git.add('.');
    await git.commit('feat: Add foo feature');

    // Create remote
    const remoteDir = await mkdtemp(join(tmpdir(), 'craft-e2e-remote-'));
    // eslint-disable-next-line no-restricted-syntax -- Test setup needs direct git access
    const remoteGit = simpleGit(remoteDir);
    await remoteGit.init(true);
    await git.addRemote('origin', remoteDir);
    const status = await git.status();
    await git.push('origin', status.current!, ['--set-upstream']);

    // Run prepare WITHOUT version argument - should use auto policy
    const { stdout, stderr } = await execFileAsync(
      CLI_BIN,
      ['prepare', '--dry-run', '--no-input'],
      {
        cwd: tempDir,
        env: {
          ...process.env,
          NODE_ENV: 'test',
          GITHUB_TOKEN: 'test-token',
        },
      },
    );

    const combinedOutput = stdout + stderr;

    // Should succeed and detect a minor version bump (due to feat: commit)
    expect(combinedOutput).toContain('Releasing version 1.1.0');
    expect(combinedOutput).toContain('release/1.1.0');
  }, 60000);

  test('auto changelog policy creates CHANGELOG.md if it does not exist', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'craft-e2e-'));
    // eslint-disable-next-line no-restricted-syntax -- Test setup needs direct git access
    const git = simpleGit(tempDir);

    // Initialize git repo
    await git.init();
    await git.addConfig('user.email', 'test@example.com');
    await git.addConfig('user.name', 'Test User');

    // Create .craft.yml with auto changelog policy - NO CHANGELOG.md file
    const craftConfig = `
minVersion: "2.14.0"
github:
  owner: test-owner
  repo: test-repo
versioning:
  policy: auto
changelog:
  policy: auto
preReleaseCommand: ""
targets: []
`;
    await writeFile(join(tempDir, '.craft.yml'), craftConfig);

    // Create package.json
    const packageJson = { name: 'test-package', version: '1.0.0' };
    await writeFile(
      join(tempDir, 'package.json'),
      JSON.stringify(packageJson, null, 2),
    );

    // Initial commit and tag - deliberately NO CHANGELOG.md
    await git.add('.');
    await git.commit('Initial commit');
    await git.addTag('1.0.0');

    // Add a feature commit
    await writeFile(join(tempDir, 'feature.ts'), 'export const foo = 1;');
    await git.add('.');
    await git.commit('feat: Add foo feature');

    // Create remote
    const remoteDir = await mkdtemp(join(tmpdir(), 'craft-e2e-remote-'));
    // eslint-disable-next-line no-restricted-syntax -- Test setup needs direct git access
    const remoteGit = simpleGit(remoteDir);
    await remoteGit.init(true);
    await git.addRemote('origin', remoteDir);
    const status = await git.status();
    await git.push('origin', status.current!, ['--set-upstream']);

    // Verify CHANGELOG.md does not exist before running
    expect(existsSync(join(tempDir, 'CHANGELOG.md'))).toBe(false);

    // Run prepare with auto changelog policy
    const { stdout, stderr } = await execFileAsync(
      CLI_BIN,
      ['prepare', '--dry-run', '--no-input'],
      {
        cwd: tempDir,
        env: {
          ...process.env,
          NODE_ENV: 'test',
          GITHUB_TOKEN: 'test-token',
        },
      },
    );

    const combinedOutput = stdout + stderr;

    // Should succeed and mention creating the changelog
    expect(combinedOutput).toContain('Creating changelog file');
    expect(combinedOutput).toContain('Releasing version 1.1.0');
  }, 60000);
});
