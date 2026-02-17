import { existsSync, mkdirSync, readFileSync, rmSync } from 'fs';
import path from 'path';
import { tmpdir } from 'os';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  disableChangelogMentions,
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
    expect(result).toContain('Changelog truncated');
  });

  test('total output (content + notice) stays within MAX_STEP_OUTPUT_BYTES', () => {
    const large = 'x'.repeat(MAX_STEP_OUTPUT_BYTES + 1000);
    const result = truncateForOutput(large);
    expect(Buffer.byteLength(result, 'utf-8')).toBeLessThanOrEqual(
      MAX_STEP_OUTPUT_BYTES,
    );
  });

  test('total output with URL stays within MAX_STEP_OUTPUT_BYTES', () => {
    const large = 'x'.repeat(MAX_STEP_OUTPUT_BYTES + 1000);
    const url =
      'https://github.com/getsentry/sentry/blob/release/25.2.0/CHANGELOG.md#L3-L538';
    const result = truncateForOutput(large, url);
    expect(Buffer.byteLength(result, 'utf-8')).toBeLessThanOrEqual(
      MAX_STEP_OUTPUT_BYTES,
    );
    expect(result).toContain(`[View full changelog](${url})`);
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

  test('does not strip last char when truncation lands on a valid boundary', () => {
    // Build a string of exactly (contentBudget + 100) ASCII bytes so the
    // byte-slice lands cleanly on a character boundary. The last char of the
    // truncated portion should NOT be stripped.
    const notice = '\n\n---\n*Changelog truncated.*';
    const noticeBytes = Buffer.byteLength(notice, 'utf-8');
    const budget = MAX_STEP_OUTPUT_BYTES - noticeBytes;
    // Use budget + 100 so truncation fires, then check the content portion
    const large = 'a'.repeat(budget + 100);
    const result = truncateForOutput(large);
    // Content portion should be exactly `budget` 'a' chars (no char was dropped)
    const contentPortion = result.slice(0, budget);
    expect(contentPortion).toBe('a'.repeat(budget));
  });
});

describe('disableChangelogMentions', () => {
  test('replaces @-mentions with bold in PR entries', () => {
    const input =
      '- Fix crash on startup by @alice in [#123](https://github.com/org/repo/pull/123)';
    const result = disableChangelogMentions(input);
    expect(result).toBe(
      '- Fix crash on startup by **alice** in [#123](https://github.com/org/repo/pull/123)',
    );
  });

  test('replaces @-mentions with bold in commit entries', () => {
    const input =
      '- Fix typo by @bob in [abcdef12](https://github.com/org/repo/commit/abcdef12)';
    const result = disableChangelogMentions(input);
    expect(result).toBe(
      '- Fix typo by **bob** in [abcdef12](https://github.com/org/repo/commit/abcdef12)',
    );
  });

  test('replaces @-mentions in backtick PR refs (disablePRLinks mode)', () => {
    const input = '- Fix bug by @charlie in `#456`';
    const result = disableChangelogMentions(input);
    expect(result).toBe('- Fix bug by **charlie** in `#456`');
  });

  test('handles multiple entries', () => {
    const input = [
      '### Bug Fixes',
      '- Fix crash by @alice in [#1](https://github.com/org/repo/pull/1)',
      '- Fix typo by @bob in [#2](https://github.com/org/repo/pull/2)',
      '- Improve perf by @charlie in [#3](https://github.com/org/repo/pull/3)',
    ].join('\n');
    const result = disableChangelogMentions(input);
    expect(result).toContain('by **alice** in');
    expect(result).toContain('by **bob** in');
    expect(result).toContain('by **charlie** in');
    expect(result).not.toContain('@alice');
    expect(result).not.toContain('@bob');
    expect(result).not.toContain('@charlie');
  });

  test('preserves entries without author mentions', () => {
    const input = '- Fix crash in [#123](https://github.com/org/repo/pull/123)';
    const result = disableChangelogMentions(input);
    expect(result).toBe(input);
  });

  test('preserves section headers and other text', () => {
    const input = [
      '### New Features',
      '- Add dark mode by @alice in [#10](https://github.com/org/repo/pull/10)',
      '',
      '### Bug Fixes',
      '- Fix crash in [#11](https://github.com/org/repo/pull/11)',
    ].join('\n');
    const result = disableChangelogMentions(input);
    expect(result).toContain('### New Features');
    expect(result).toContain('### Bug Fixes');
    expect(result).toContain('by **alice** in');
    expect(result).not.toContain('@alice');
  });

  test('returns empty string unchanged', () => {
    expect(disableChangelogMentions('')).toBe('');
  });
});
