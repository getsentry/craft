import { existsSync, mkdirSync, readFileSync, rmSync } from 'fs';
import path from 'path';
import { tmpdir } from 'os';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  envToBool,
  MAX_STEP_OUTPUT_BYTES,
  setGitHubActionsOutput,
  truncateForOutput,
  writeGitHubActionsFile,
} from '../helpers';

describe('envToBool', () =>
  test.each([
    [undefined, false],
    [null, false],
    [false, false],
    ['undefined', false],
    ['null', false],
    ['', false],
    ['0', false],
    ['no', false],
    [true, true],
    ['true', true],
    [1, true],
    ['1', true],
    ['yes', true],
    ['dogs are great!', true],
  ])('From %j we should get "%s"', (envVar, result) =>
    expect(envToBool(envVar)).toBe(result),
  ));

describe('setGitHubActionsOutput', () => {
  let outputFile: string;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    const dir = path.join(tmpdir(), `craft-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    outputFile = path.join(dir, 'GITHUB_OUTPUT');
    process.env.GITHUB_OUTPUT = outputFile;
    // Create the file so appendFileSync works
    require('fs').writeFileSync(outputFile, '');
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    if (existsSync(outputFile)) {
      rmSync(path.dirname(outputFile), { recursive: true, force: true });
    }
  });

  test('writes single-line value as name=value', () => {
    setGitHubActionsOutput('version', '1.2.3');
    const content = readFileSync(outputFile, 'utf-8');
    expect(content).toBe('version=1.2.3\n');
  });

  test('writes multiline value with heredoc delimiter', () => {
    setGitHubActionsOutput('changelog', 'line1\nline2');
    const content = readFileSync(outputFile, 'utf-8');
    expect(content).toMatch(
      /^changelog<<EOF_\d+_\w+\nline1\nline2\nEOF_\d+_\w+\n$/,
    );
  });

  test('is a no-op when GITHUB_OUTPUT is not set', () => {
    delete process.env.GITHUB_OUTPUT;
    // Should not throw
    setGitHubActionsOutput('key', 'value');
  });
});

describe('writeGitHubActionsFile', () => {
  let tempDir: string;
  let outputFile: string;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    tempDir = path.join(tmpdir(), `craft-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    outputFile = path.join(tempDir, 'GITHUB_OUTPUT');
    require('fs').writeFileSync(outputFile, '');
    process.env.RUNNER_TEMP = tempDir;
    process.env.GITHUB_OUTPUT = outputFile;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('writes content to a file under RUNNER_TEMP/craft/', () => {
    const filePath = writeGitHubActionsFile('changelog', 'hello world');
    expect(filePath).toBeDefined();
    expect(filePath).toContain(path.join('craft', 'changelog.md'));
    expect(readFileSync(filePath!, 'utf-8')).toBe('hello world');
  });

  test('sets a {name}_file output pointing to the file', () => {
    const filePath = writeGitHubActionsFile('changelog', 'content');
    const output = readFileSync(outputFile, 'utf-8');
    expect(output).toContain(`changelog_file=${filePath}`);
  });

  test('returns undefined when RUNNER_TEMP is not set', () => {
    delete process.env.RUNNER_TEMP;
    const result = writeGitHubActionsFile('changelog', 'content');
    expect(result).toBeUndefined();
  });

  test('creates the craft/ subdirectory if it does not exist', () => {
    const craftDir = path.join(tempDir, 'craft');
    expect(existsSync(craftDir)).toBe(false);
    writeGitHubActionsFile('test', 'data');
    expect(existsSync(craftDir)).toBe(true);
  });
});

describe('truncateForOutput', () => {
  test('returns the original string when under the limit', () => {
    const short = 'This is a short changelog';
    expect(truncateForOutput(short)).toBe(short);
  });

  test('truncates strings exceeding MAX_STEP_OUTPUT_BYTES', () => {
    // Create a string that exceeds 64KB
    const large = 'x'.repeat(MAX_STEP_OUTPUT_BYTES + 1000);
    const result = truncateForOutput(large);
    expect(Buffer.byteLength(result, 'utf-8')).toBeLessThan(
      MAX_STEP_OUTPUT_BYTES + 200, // truncation notice adds some bytes
    );
    expect(result).toContain('Changelog truncated');
  });

  test('includes changelog URL as a markdown link when provided', () => {
    const large = 'x'.repeat(MAX_STEP_OUTPUT_BYTES + 1000);
    const url =
      'https://github.com/getsentry/sentry/blob/release/25.2.0/CHANGELOG.md';
    const result = truncateForOutput(large, url);
    expect(result).toContain(`[View full changelog](${url})`);
  });

  test('does not include a link when no URL is provided', () => {
    const large = 'x'.repeat(MAX_STEP_OUTPUT_BYTES + 1000);
    const result = truncateForOutput(large);
    expect(result).toContain('Changelog truncated');
    expect(result).not.toContain('View full changelog');
  });

  test('handles multi-byte characters at the boundary', () => {
    // Create a string with multi-byte chars (emoji = 4 bytes each)
    const emoji = '\u{1F600}'; // 😀 = 4 bytes in UTF-8
    const filler = 'x'.repeat(MAX_STEP_OUTPUT_BYTES - 10);
    const large = filler + emoji.repeat(10);
    const result = truncateForOutput(large);
    // Should not throw and should produce valid UTF-8
    expect(Buffer.from(result, 'utf-8').toString('utf-8')).toBe(result);
    expect(result).toContain('Changelog truncated');
  });
});
