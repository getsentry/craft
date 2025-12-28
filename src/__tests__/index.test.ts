import { vi, describe, test, expect } from 'vitest';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { resolve } from 'path';

const execFileAsync = promisify(execFile);

// Path to the TypeScript source file - we use ts-node to run it directly
const CLI_ENTRY = resolve(__dirname, '../index.ts');

describe('CLI smoke tests', () => {
  test('CLI starts and shows help without runtime errors', async () => {
    // This catches issues like:
    // - Missing dependencies
    // - Syntax errors
    // - Runtime initialization errors (e.g., yargs singleton usage in v18)
    const { stdout, stderr } = await execFileAsync(
      'npx',
      ['ts-node', '--transpile-only', CLI_ENTRY, '--help'],
      { env: { ...process.env, NODE_ENV: 'test' } }
    );

    expect(stdout).toMatch(/<command>/);
    expect(stdout).toContain('prepare NEW-VERSION');
    expect(stdout).toContain('publish NEW-VERSION');
    expect(stdout).toContain('--help');
    // Ensure no error output (warnings are acceptable)
    expect(stderr).not.toContain('Error');
    expect(stderr).not.toContain('TypeError');
  }, 30000);

  test('CLI shows version without errors', async () => {
    const { stdout } = await execFileAsync(
      'npx',
      ['ts-node', '--transpile-only', CLI_ENTRY, '--version'],
      { env: { ...process.env, NODE_ENV: 'test' } }
    );

    // Version should be a semver-like string
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  }, 30000);

  test('CLI exits with error for unknown command', async () => {
    // This ensures yargs command parsing works and async handlers are awaited
    await expect(
      execFileAsync(
        'npx',
        ['ts-node', '--transpile-only', CLI_ENTRY, 'nonexistent-command'],
        { env: { ...process.env, NODE_ENV: 'test' } }
      )
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
      await execFileAsync(
        'npx',
        ['ts-node', '--transpile-only', CLI_ENTRY, 'targets'],
        {
          env: { ...process.env, NODE_ENV: 'test' },
          cwd: '/tmp', // No .craft.yml here
        }
      );
    } catch (error: any) {
      // Should fail with a config error, not a silent exit or unhandled promise
      expect(error.stderr || error.stdout).toMatch(
        /Cannot find configuration file|craft\.yml|config/i
      );
    }
  }, 30000);
});
