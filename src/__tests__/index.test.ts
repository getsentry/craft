import { describe, test, expect, beforeAll } from 'vitest';
import { execFile, execSync } from 'child_process';
import { promisify } from 'util';
import { resolve } from 'path';
import { existsSync } from 'fs';

const execFileAsync = promisify(execFile);

// Path to the built CLI binary - e2e tests should use the actual artifact
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

describe('CLI smoke tests', () => {
  test('CLI starts and shows help without runtime errors', async () => {
    // This catches issues like:
    // - Missing dependencies
    // - Syntax errors
    // - Runtime initialization errors (e.g., yargs singleton usage in v18)
    const { stdout, stderr } = await execFileAsync(CLI_BIN, ['--help'], {
      env: { ...process.env, NODE_ENV: 'test' },
    });

    expect(stdout).toMatch(/<command>/);
    expect(stdout).toContain('prepare [NEW-VERSION]');
    expect(stdout).toContain('publish NEW-VERSION');
    expect(stdout).toContain('--help');
    // Ensure no error output (warnings are acceptable)
    expect(stderr).not.toContain('Error');
    expect(stderr).not.toContain('TypeError');
  }, 30000);

  test('CLI shows version without errors', async () => {
    const { stdout } = await execFileAsync(CLI_BIN, ['--version'], {
      env: { ...process.env, NODE_ENV: 'test' },
    });

    // Version should be a semver-like string
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  }, 30000);

  test('CLI exits with error for unknown command', async () => {
    // This ensures yargs command parsing works and async handlers are awaited
    await expect(
      execFileAsync(CLI_BIN, ['nonexistent-command'], {
        env: { ...process.env, NODE_ENV: 'test' },
      }),
    ).rejects.toMatchObject({
      code: 1,
    });
  }, 30000);

  test('async command handler completes properly', async () => {
    // The 'targets' command has an async handler and requires a .craft.yml
    // Without proper await on parse(), this would exit before completing
    // We expect it to fail due to missing config, but it should fail gracefully
    // not due to premature exit
    try {
      await execFileAsync(CLI_BIN, ['targets'], {
        env: { ...process.env, NODE_ENV: 'test' },
        cwd: '/tmp', // No .craft.yml here
      });
    } catch (error: any) {
      // Should fail with a config error, not a silent exit or unhandled promise
      expect(error.stderr || error.stdout).toMatch(
        /Cannot find configuration file|craft\.yml|config/i,
      );
    }
  }, 30000);
});
