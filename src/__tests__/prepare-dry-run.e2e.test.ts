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
import simpleGit from 'simple-git';

const execFileAsync = promisify(execFile);

// Base environment for CLI invocations. Prevents "Terminal is dumb, but EDITOR
// unset" errors in non-interactive environments (e.g., CI with TERM=dumb) where
// the craft CLI invokes git internally via simple-git. GPG signing is disabled
// to avoid requiring signing keys in test environments.
const CLI_ENV: Record<string, string> = {
  ...(process.env as Record<string, string>),
  NODE_ENV: 'test',
  GITHUB_TOKEN: 'test-token',
  GIT_COMMITTER_NAME: 'Test User',
  GIT_COMMITTER_EMAIL: 'test@example.com',
  GIT_AUTHOR_NAME: 'Test User',
  GIT_AUTHOR_EMAIL: 'test@example.com',
};

// Path to the built CLI binary - e2e tests use the actual artifact
const CLI_BIN = resolve(__dirname, '../../dist/craft');
const remoteDirs = new Set<string>();

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
async function createBareRemote(): Promise<string> {
  const remoteDir = await mkdtemp(join(tmpdir(), 'craft-e2e-remote-'));
  remoteDirs.add(remoteDir);
  // eslint-disable-next-line no-restricted-syntax -- Test setup needs direct git access
  await simpleGit(remoteDir).init(true);
  return remoteDir;
}

async function createTestRepo(preReleaseCommand = ''): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), 'craft-e2e-'));
  // eslint-disable-next-line no-restricted-syntax -- Test setup needs direct git access
  const git = simpleGit(tempDir);

  // Initialize git repo
  await git.init();
  await git.addConfig('user.email', 'test@example.com');
  await git.addConfig('user.name', 'Test User');
  // Disable GPG signing in test repos to avoid editor/terminal issues
  await git.addConfig('commit.gpgsign', 'false');
  await git.addConfig('tag.gpgsign', 'false');

  // Create .craft.yml with explicit GitHub config
  const craftConfig = `
minVersion: "2.0.0"
github:
  owner: test-owner
  repo: test-repo
changelog:
  policy: none
preReleaseCommand: "${preReleaseCommand}"
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
  const remoteDir = await createBareRemote();
  await git.addRemote('origin', remoteDir);
  // Push the main branch to set up tracking
  const status = await git.status();
  await git.push('origin', status.current!, ['--set-upstream']);

  return tempDir;
}

async function runCliExpectFailure(
  cwd: string,
  args: string[],
  env: Record<string, string> = CLI_ENV,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return execFileAsync(CLI_BIN, args, { cwd, env }).then(
    () => {
      throw new Error('Expected craft command to fail');
    },
    error =>
      error as {
        code: number;
        stdout: string;
        stderr: string;
      },
  );
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
    await Promise.all(
      Array.from(remoteDirs, remoteDir =>
        rm(remoteDir, { recursive: true, force: true }),
      ),
    );
    remoteDirs.clear();
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
        env: CLI_ENV,
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
        env: CLI_ENV,
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

  test('stops before preparing an existing remote release branch', async () => {
    tempDir = await createTestRepo();
    // eslint-disable-next-line no-restricted-syntax -- Test setup needs direct git access
    const git = simpleGit(tempDir);
    const currentBranch = (await git.status()).current!;
    const outputPath = join(tempDir, 'github-output');

    await git.checkoutLocalBranch('release/1.0.1');
    const releaseSha = (await git.revparse(['HEAD'])).trim();
    await git.push('origin', 'release/1.0.1');
    await git.checkout(currentBranch);
    await git.deleteLocalBranch('release/1.0.1');

    const result = await runCliExpectFailure(
      tempDir,
      ['prepare', '1.0.1', '--dry-run', '--no-input'],
      { ...CLI_ENV, GITHUB_OUTPUT: outputPath },
    );

    expect(result.code).toBe(1);
    expect(result.stdout + result.stderr).toContain(
      'A release for version 1.0.1 is already pending. Resume and publish it before preparing another release.',
    );
    expect(result.stdout + result.stderr).not.toContain(
      '[dry-run] Creating temporary worktree',
    );
    expect(existsSync(outputPath)).toBe(false);

    const localBranches = await git.branchLocal();
    expect(localBranches.all).not.toContain('release/1.0.1');
    await expect(
      git.listRemote(['--heads', 'origin', 'refs/heads/release/1.0.1']),
    ).resolves.toBe(`${releaseSha}\trefs/heads/release/1.0.1\n`);
  }, 60000);

  test('checks every push URL instead of the fetch URL', async () => {
    tempDir = await createTestRepo();
    // eslint-disable-next-line no-restricted-syntax -- Test setup needs direct git access
    const git = simpleGit(tempDir);
    const currentBranch = (await git.status()).current!;
    const emptyPushRemoteDir = await createBareRemote();
    const pushRemoteDir = await createBareRemote();

    await git.push(emptyPushRemoteDir, currentBranch);
    await git.push(pushRemoteDir, currentBranch);
    await git.checkoutLocalBranch('release/1.0.1');
    const releaseSha = (await git.revparse(['HEAD'])).trim();
    await git.push(pushRemoteDir, 'release/1.0.1');
    await git.checkout(currentBranch);
    await git.deleteLocalBranch('release/1.0.1');
    await git.raw(
      'config',
      '--add',
      'remote.origin.pushurl',
      emptyPushRemoteDir,
    );
    await git.raw('config', '--add', 'remote.origin.pushurl', pushRemoteDir);

    const result = await runCliExpectFailure(tempDir, [
      'prepare',
      '1.0.1',
      '--no-input',
    ]);

    expect(result.code).toBe(1);
    expect(result.stdout + result.stderr).toContain(
      'A release for version 1.0.1 is already pending. Resume and publish it before preparing another release.',
    );
    expect((await git.branchLocal()).all).not.toContain('release/1.0.1');
    await expect(
      git.listRemote(['--heads', pushRemoteDir, 'refs/heads/release/1.0.1']),
    ).resolves.toBe(`${releaseSha}\trefs/heads/release/1.0.1\n`);
  }, 60000);

  test('preserves a release branch created while preparing', async () => {
    tempDir = await createTestRepo('./create-racing-branch.sh');
    // eslint-disable-next-line no-restricted-syntax -- Test setup needs direct git access
    const git = simpleGit(tempDir);
    const currentBranch = (await git.status()).current!;
    const scriptPath = join(tempDir, 'create-racing-branch.sh');
    await writeFile(
      scriptPath,
      '#!/bin/sh\ngit push origin HEAD:refs/heads/release/1.0.1\necho prepared >> release-prepared\n',
    );
    await chmod(scriptPath, '755');
    await writeFile(join(tempDir, 'release-prepared'), '');
    await git.add('.');
    await git.commit('Add racing release script');
    await git.push('origin', currentBranch);
    const competingReleaseSha = (await git.revparse(['HEAD'])).trim();

    const result = await runCliExpectFailure(tempDir, [
      'prepare',
      '1.0.1',
      '--no-changelog',
      '--no-input',
    ]);

    expect(result.code).toBe(1);
    await expect(
      readFile(join(tempDir, 'release-prepared'), 'utf8'),
    ).resolves.toBe('prepared\n');
    await expect(
      git.listRemote(['--heads', 'origin', 'refs/heads/release/1.0.1']),
    ).resolves.toBe(`${competingReleaseSha}\trefs/heads/release/1.0.1\n`);
    expect((await git.revparse(['release/1.0.1'])).trim()).not.toBe(
      competingReleaseSha,
    );
  }, 60000);

  test('pushes a new release branch and configures its upstream', async () => {
    tempDir = await createTestRepo();
    // eslint-disable-next-line no-restricted-syntax -- Test setup needs direct git access
    const git = simpleGit(tempDir);

    await execFileAsync(CLI_BIN, ['prepare', '1.0.1', '--no-input'], {
      cwd: tempDir,
      env: CLI_ENV,
    });

    const releaseSha = (await git.revparse(['release/1.0.1'])).trim();
    await expect(
      git.listRemote(['--heads', 'origin', 'refs/heads/release/1.0.1']),
    ).resolves.toBe(`${releaseSha}\trefs/heads/release/1.0.1\n`);
    await expect(
      git.raw('config', '--get', 'branch.release/1.0.1.remote'),
    ).resolves.toBe('origin\n');
    await expect(
      git.raw('config', '--get', 'branch.release/1.0.1.merge'),
    ).resolves.toBe('refs/heads/release/1.0.1\n');
  }, 60000);

  test('keeps the remote untouched when pushing is disabled', async () => {
    tempDir = await createTestRepo();
    // eslint-disable-next-line no-restricted-syntax -- Test setup needs direct git access
    const git = simpleGit(tempDir);

    const { stdout, stderr } = await execFileAsync(
      CLI_BIN,
      ['prepare', '1.0.1', '--no-push', '--no-input'],
      { cwd: tempDir, env: CLI_ENV },
    );

    expect(stdout + stderr).toContain(
      'git push --set-upstream --force-with-lease=refs/heads/release/1.0.1: origin refs/heads/release/1.0.1:refs/heads/release/1.0.1',
    );
    expect((await git.branchLocal()).all).toContain('release/1.0.1');
    await expect(
      git.listRemote(['--heads', 'origin', 'refs/heads/release/1.0.1']),
    ).resolves.toBe('');
  }, 60000);

  test('fails closed when a push destination cannot be inspected', async () => {
    tempDir = await createTestRepo();
    // eslint-disable-next-line no-restricted-syntax -- Test setup needs direct git access
    const git = simpleGit(tempDir);
    const outputPath = join(tempDir, 'github-output');
    await git.addConfig(
      'remote.origin.pushurl',
      join(tempDir, 'missing-remote.git'),
    );

    const result = await runCliExpectFailure(
      tempDir,
      ['prepare', '1.0.1', '--dry-run', '--no-input'],
      { ...CLI_ENV, GITHUB_OUTPUT: outputPath },
    );

    expect(result.code).toBe(1);
    expect(result.stdout + result.stderr).toContain(
      'Failed to inspect push destinations for remote "origin".',
    );
    expect(existsSync(outputPath)).toBe(false);
    expect((await git.branchLocal()).all).not.toContain('release/1.0.1');
  }, 60000);

  test('allows a different remote release branch', async () => {
    tempDir = await createTestRepo();
    // eslint-disable-next-line no-restricted-syntax -- Test setup needs direct git access
    const git = simpleGit(tempDir);
    const currentBranch = (await git.status()).current!;

    await git.checkoutLocalBranch('release/1.0.10');
    await git.push('origin', 'release/1.0.10');
    await git.checkout(currentBranch);
    await git.deleteLocalBranch('release/1.0.10');

    const { stdout, stderr } = await execFileAsync(
      CLI_BIN,
      ['prepare', '1.0.1', '--dry-run', '--no-input'],
      { cwd: tempDir, env: CLI_ENV },
    );

    expect(stdout + stderr).toContain(
      'Created a new release branch: "release/1.0.1"',
    );
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
        env: CLI_ENV,
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
          env: CLI_ENV,
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
    // Disable GPG signing in test repos to avoid editor/terminal issues
    await git.addConfig('commit.gpgsign', 'false');
    await git.addConfig('tag.gpgsign', 'false');

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
        env: CLI_ENV,
      },
    );

    const combinedOutput = stdout + stderr;

    // Should succeed and detect a minor version bump (due to feat: commit)
    expect(combinedOutput).toContain('Releasing version 1.1.0');
    expect(combinedOutput).toContain('release/1.1.0');
  }, 60000);

  test('prepares a workspace changelog without changing the root changelog', async () => {
    tempDir = await createTestRepo();
    // eslint-disable-next-line no-restricted-syntax -- Test setup needs direct git access
    const git = simpleGit(tempDir);
    await mkdir(join(tempDir, 'packages', 'cli'), { recursive: true });
    await writeFile(
      join(tempDir, '.craft.yml'),
      `minVersion: "2.29.0"
github:
  owner: test-owner
  repo: test-repo
preReleaseCommand: ""
workspaces:
  packages/cli:
    changelog:
      policy: auto
    versioning:
      policy: auto
    targets: []
`,
    );
    await writeFile(
      join(tempDir, 'packages', 'cli', 'CHANGELOG.md'),
      '# CLI changelog\n\n## 1.0.0\n\n- Initial release\n',
    );
    await git.add('.');
    await git.commit('chore: Configure CLI workspace');
    await git.push('origin', (await git.status()).current!);

    const { stdout, stderr } = await execFileAsync(
      CLI_BIN,
      ['prepare', '--workspace=packages/cli', '--dry-run', '--no-input'],
      { cwd: tempDir, env: { ...CLI_ENV, GITHUB_TOKEN: '' } },
    );

    expect(stdout + stderr).toContain('packages/cli/CHANGELOG.md');
    expect(stdout + stderr).not.toContain('diff --git a/CHANGELOG.md');
    expect(await readFile(join(tempDir, 'CHANGELOG.md'), 'utf8')).toContain(
      '## 1.0.0',
    );
  }, 60000);

  test('auto changelog policy creates CHANGELOG.md if it does not exist', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'craft-e2e-'));
    // eslint-disable-next-line no-restricted-syntax -- Test setup needs direct git access
    const git = simpleGit(tempDir);

    // Initialize git repo
    await git.init();
    await git.addConfig('user.email', 'test@example.com');
    await git.addConfig('user.name', 'Test User');
    // Disable GPG signing in test repos to avoid editor/terminal issues
    await git.addConfig('commit.gpgsign', 'false');
    await git.addConfig('tag.gpgsign', 'false');

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
        env: CLI_ENV,
      },
    );

    const combinedOutput = stdout + stderr;

    // Should succeed and mention creating the changelog
    expect(combinedOutput).toContain('Creating changelog file');
    expect(combinedOutput).toContain('Releasing version 1.1.0');

    // The diff should include the new CHANGELOG.md (it must be committed)
    expect(combinedOutput).toContain("Here's what would change");
    expect(combinedOutput).toContain('CHANGELOG.md');
  }, 60000);

  test('commits changelog even when no preReleaseCommand runs and targets have no bumpVersion', async () => {
    // Reproduces the sentry-go scenario: auto changelog + github-only targets
    // (no bumpVersion support) + no preReleaseCommand → changelog must still
    // be committed.
    tempDir = await mkdtemp(join(tmpdir(), 'craft-e2e-'));
    // eslint-disable-next-line no-restricted-syntax -- Test setup needs direct git access
    const git = simpleGit(tempDir);

    await git.init();
    await git.addConfig('user.email', 'test@example.com');
    await git.addConfig('user.name', 'Test User');
    // Disable GPG signing in test repos to avoid editor/terminal issues
    await git.addConfig('commit.gpgsign', 'false');
    await git.addConfig('tag.gpgsign', 'false');

    // Config with auto changelog, no preReleaseCommand, github-only targets
    // (github target does not have bumpVersion, so auto-bumping returns false)
    const craftConfig = `
minVersion: "2.21.0"
github:
  owner: test-owner
  repo: test-repo
versioning:
  policy: auto
changelog:
  policy: auto
targets:
  - name: github
`;
    await writeFile(join(tempDir, '.craft.yml'), craftConfig);

    // Create CHANGELOG.md (already tracked, like sentry-go)
    await writeFile(join(tempDir, 'CHANGELOG.md'), '# Changelog\n');

    // Initial commit and tag
    await git.add('.');
    await git.commit('Initial commit');
    await git.addTag('1.0.0');

    // Add a feature commit
    await writeFile(join(tempDir, 'feature.go'), 'package main');
    await git.add('.');
    await git.commit('feat: Add new feature');

    // Create remote
    const remoteDir = await mkdtemp(join(tmpdir(), 'craft-e2e-remote-'));
    // eslint-disable-next-line no-restricted-syntax -- Test setup needs direct git access
    const remoteGit = simpleGit(remoteDir);
    await remoteGit.init(true);
    await git.addRemote('origin', remoteDir);
    const status = await git.status();
    await git.push('origin', status.current!, ['--set-upstream']);

    const { stdout, stderr } = await execFileAsync(
      CLI_BIN,
      ['prepare', '--dry-run', '--no-input'],
      {
        cwd: tempDir,
        env: CLI_ENV,
      },
    );

    const combinedOutput = stdout + stderr;

    // Should succeed with auto-detected version
    expect(combinedOutput).toContain('Releasing version 1.1.0');
    expect(combinedOutput).toContain('release/1.1.0');

    // The diff MUST show CHANGELOG.md changes — this was the bug
    expect(combinedOutput).toContain("Here's what would change");
    expect(combinedOutput).toContain('CHANGELOG.md');
  }, 60000);
});
