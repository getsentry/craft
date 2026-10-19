import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import os from 'os';

import { isCompiledGitHubAction } from '../detection';

describe('isCompiledGitHubAction', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(
      os.tmpdir(),
      `craft-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('returns false when no action.yml exists', () => {
    expect(isCompiledGitHubAction(tempDir)).toBe(false);
  });

  test('returns false for composite action', () => {
    writeFileSync(
      join(tempDir, 'action.yml'),
      `name: 'My Action'
runs:
  using: 'composite'
  steps:
    - run: echo "Hello"
      shell: bash
`,
    );
    expect(isCompiledGitHubAction(tempDir)).toBe(false);
  });

  test('returns false for docker action', () => {
    writeFileSync(
      join(tempDir, 'action.yml'),
      `name: 'My Docker Action'
runs:
  using: 'docker'
  image: 'Dockerfile'
`,
    );
    expect(isCompiledGitHubAction(tempDir)).toBe(false);
  });

  test('returns true for node20 action with dist/index.js', () => {
    writeFileSync(
      join(tempDir, 'action.yml'),
      `name: 'My Node Action'
runs:
  using: 'node20'
  main: 'dist/index.js'
`,
    );
    expect(isCompiledGitHubAction(tempDir)).toBe(true);
  });

  test('returns true for node16 action with ./dist/index.js', () => {
    writeFileSync(
      join(tempDir, 'action.yml'),
      `name: 'My Node Action'
runs:
  using: 'node16'
  main: './dist/index.js'
`,
    );
    expect(isCompiledGitHubAction(tempDir)).toBe(true);
  });

  test('returns true for node12 action with dist/main.js', () => {
    writeFileSync(
      join(tempDir, 'action.yml'),
      `name: 'My Node Action'
runs:
  using: 'node12'
  main: 'dist/main.js'
`,
    );
    expect(isCompiledGitHubAction(tempDir)).toBe(true);
  });

  test('returns false for node action without dist/ in main path', () => {
    writeFileSync(
      join(tempDir, 'action.yml'),
      `name: 'My Node Action'
runs:
  using: 'node20'
  main: 'src/index.js'
`,
    );
    expect(isCompiledGitHubAction(tempDir)).toBe(false);
  });

  test('returns false for node action with nested dist/ path (not root-level)', () => {
    // This should NOT be detected as a compiled action because dist/ is not at the root
    writeFileSync(
      join(tempDir, 'action.yml'),
      `name: 'My Node Action'
runs:
  using: 'node20'
  main: 'lib/dist/index.js'
`,
    );
    expect(isCompiledGitHubAction(tempDir)).toBe(false);
  });

  test('returns false for node action with no main field', () => {
    writeFileSync(
      join(tempDir, 'action.yml'),
      `name: 'My Node Action'
runs:
  using: 'node20'
`,
    );
    expect(isCompiledGitHubAction(tempDir)).toBe(false);
  });

  test('works with action.yaml (alternative extension)', () => {
    writeFileSync(
      join(tempDir, 'action.yaml'),
      `name: 'My Node Action'
runs:
  using: 'node20'
  main: 'dist/index.js'
`,
    );
    expect(isCompiledGitHubAction(tempDir)).toBe(true);
  });

  test('returns false for malformed YAML', () => {
    writeFileSync(join(tempDir, 'action.yml'), 'this is not: valid: yaml: {{');
    expect(isCompiledGitHubAction(tempDir)).toBe(false);
  });

  test('returns false for empty action.yml', () => {
    writeFileSync(join(tempDir, 'action.yml'), '');
    expect(isCompiledGitHubAction(tempDir)).toBe(false);
  });

  test('prefers action.yml over action.yaml', () => {
    // action.yml is NOT a compiled action
    writeFileSync(
      join(tempDir, 'action.yml'),
      `name: 'Composite'
runs:
  using: 'composite'
  steps:
    - run: echo "Hello"
      shell: bash
`,
    );
    // action.yaml IS a compiled action - but action.yml takes precedence
    writeFileSync(
      join(tempDir, 'action.yaml'),
      `name: 'Node'
runs:
  using: 'node20'
  main: 'dist/index.js'
`,
    );
    expect(isCompiledGitHubAction(tempDir)).toBe(false);
  });

  test('empty action.yml still takes precedence over valid action.yaml', () => {
    // Empty action.yml should still be preferred (and result in false)
    writeFileSync(join(tempDir, 'action.yml'), '');
    // action.yaml IS a compiled action - but empty action.yml takes precedence
    writeFileSync(
      join(tempDir, 'action.yaml'),
      `name: 'Node'
runs:
  using: 'node20'
  main: 'dist/index.js'
`,
    );
    expect(isCompiledGitHubAction(tempDir)).toBe(false);
  });
});
