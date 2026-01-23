import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { isCompiledGitHubAction } from '../detection';
import { NpmTarget } from '../../targets/npm';
import { PypiTarget } from '../../targets/pypi';
import { CratesTarget } from '../../targets/crates';
import { DockerTarget } from '../../targets/docker';
import { GemTarget } from '../../targets/gem';
import { PubDevTarget } from '../../targets/pubDev';
import { GitHubTarget } from '../../targets/github';
import { DetectionContext, TargetPriority } from '../detection';

describe('isCompiledGitHubAction', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(
      tmpdir(),
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

describe('Target Detection', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(
      tmpdir(),
      `craft-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const createContext = (
    overrides?: Partial<DetectionContext>,
  ): DetectionContext => ({
    rootDir: tempDir,
    ...overrides,
  });

  describe('NpmTarget.detect', () => {
    test('returns null when no package.json exists', () => {
      const result = NpmTarget.detect(createContext());
      expect(result).toBeNull();
    });

    test('returns null for private package without workspaces', () => {
      writeFileSync(
        join(tempDir, 'package.json'),
        JSON.stringify({ name: 'test-pkg', private: true }),
      );
      const result = NpmTarget.detect(createContext());
      expect(result).toBeNull();
    });

    test('detects public npm package', () => {
      writeFileSync(
        join(tempDir, 'package.json'),
        JSON.stringify({ name: 'test-pkg', version: '1.0.0' }),
      );
      const result = NpmTarget.detect(createContext());
      expect(result).not.toBeNull();
      expect(result?.config.name).toBe('npm');
      expect(result?.priority).toBe(TargetPriority.NPM);
    });

    test('detects npm workspace package', () => {
      writeFileSync(
        join(tempDir, 'package.json'),
        JSON.stringify({
          name: 'test-monorepo',
          private: true,
          workspaces: ['packages/*'],
        }),
      );
      const result = NpmTarget.detect(createContext());
      expect(result).not.toBeNull();
      expect(result?.config.name).toBe('npm');
      expect(result?.config.workspaces).toBe(true);
    });
  });

  describe('PypiTarget.detect', () => {
    test('returns null when no Python files exist', () => {
      const result = PypiTarget.detect(createContext());
      expect(result).toBeNull();
    });

    test('detects pyproject.toml with [project]', () => {
      writeFileSync(
        join(tempDir, 'pyproject.toml'),
        '[project]\nname = "test-pkg"\nversion = "1.0.0"',
      );
      const result = PypiTarget.detect(createContext());
      expect(result).not.toBeNull();
      expect(result?.config.name).toBe('pypi');
      expect(result?.priority).toBe(TargetPriority.PYPI);
    });

    test('detects pyproject.toml with [tool.poetry]', () => {
      writeFileSync(
        join(tempDir, 'pyproject.toml'),
        '[tool.poetry]\nname = "test-pkg"\nversion = "1.0.0"',
      );
      const result = PypiTarget.detect(createContext());
      expect(result).not.toBeNull();
      expect(result?.config.name).toBe('pypi');
    });

    test('detects setup.py', () => {
      writeFileSync(join(tempDir, 'setup.py'), 'from setuptools import setup');
      const result = PypiTarget.detect(createContext());
      expect(result).not.toBeNull();
      expect(result?.config.name).toBe('pypi');
    });
  });

  describe('CratesTarget.detect', () => {
    test('returns null when no Cargo.toml exists', () => {
      const result = CratesTarget.detect(createContext());
      expect(result).toBeNull();
    });

    test('detects Cargo.toml with [package]', () => {
      writeFileSync(
        join(tempDir, 'Cargo.toml'),
        '[package]\nname = "test-crate"\nversion = "1.0.0"',
      );
      const result = CratesTarget.detect(createContext());
      expect(result).not.toBeNull();
      expect(result?.config.name).toBe('crates');
      expect(result?.priority).toBe(TargetPriority.CRATES);
    });

    test('detects Cargo.toml with workspace', () => {
      writeFileSync(
        join(tempDir, 'Cargo.toml'),
        '[workspace]\nmembers = ["crate-a", "crate-b"]',
      );
      const result = CratesTarget.detect(createContext());
      expect(result).not.toBeNull();
      expect(result?.config.name).toBe('crates');
    });
  });

  describe('DockerTarget.detect', () => {
    test('returns null when no Dockerfile exists', () => {
      const result = DockerTarget.detect(createContext());
      expect(result).toBeNull();
    });

    test('detects Dockerfile', () => {
      writeFileSync(join(tempDir, 'Dockerfile'), 'FROM node:18');
      const result = DockerTarget.detect(createContext());
      expect(result).not.toBeNull();
      expect(result?.config.name).toBe('docker');
      expect(result?.priority).toBe(TargetPriority.DOCKER);
    });

    test('includes ghcr.io source when GitHub info available', () => {
      writeFileSync(join(tempDir, 'Dockerfile'), 'FROM node:18');
      const result = DockerTarget.detect(
        createContext({ githubOwner: 'getsentry', githubRepo: 'craft' }),
      );
      expect(result).not.toBeNull();
      expect(result?.config.source).toBe('ghcr.io/getsentry/craft');
      expect(result?.config.target).toBe('getsentry/craft');
    });
  });

  describe('GemTarget.detect', () => {
    test('returns null when no Gemfile exists', () => {
      const result = GemTarget.detect(createContext());
      expect(result).toBeNull();
    });

    test('returns null when Gemfile exists but no gemspec', () => {
      writeFileSync(join(tempDir, 'Gemfile'), 'source "https://rubygems.org"');
      const result = GemTarget.detect(createContext());
      expect(result).toBeNull();
    });

    test('detects gemspec file', () => {
      writeFileSync(join(tempDir, 'Gemfile'), 'source "https://rubygems.org"');
      writeFileSync(join(tempDir, 'test.gemspec'), 'Gem::Specification.new');
      const result = GemTarget.detect(createContext());
      expect(result).not.toBeNull();
      expect(result?.config.name).toBe('gem');
      expect(result?.priority).toBe(TargetPriority.GEM);
    });
  });

  describe('PubDevTarget.detect', () => {
    test('returns null when no pubspec.yaml exists', () => {
      const result = PubDevTarget.detect(createContext());
      expect(result).toBeNull();
    });

    test('detects pubspec.yaml', () => {
      writeFileSync(
        join(tempDir, 'pubspec.yaml'),
        'name: test_pkg\nversion: 1.0.0',
      );
      const result = PubDevTarget.detect(createContext());
      expect(result).not.toBeNull();
      expect(result?.config.name).toBe('pub-dev');
      expect(result?.priority).toBe(TargetPriority.PUB_DEV);
    });
  });

  describe('GitHubTarget.detect', () => {
    test('returns null when no GitHub info available', () => {
      const result = GitHubTarget.detect(createContext());
      expect(result).toBeNull();
    });

    test('detects GitHub repo', () => {
      const result = GitHubTarget.detect(
        createContext({ githubOwner: 'getsentry', githubRepo: 'craft' }),
      );
      expect(result).not.toBeNull();
      expect(result?.config.name).toBe('github');
      expect(result?.priority).toBe(TargetPriority.GITHUB);
    });
  });

  describe('Priority ordering', () => {
    test('npm comes before github', () => {
      expect(TargetPriority.NPM).toBeLessThan(TargetPriority.GITHUB);
    });

    test('pypi comes before docker', () => {
      expect(TargetPriority.PYPI).toBeLessThan(TargetPriority.DOCKER);
    });

    test('docker comes before github', () => {
      expect(TargetPriority.DOCKER).toBeLessThan(TargetPriority.GITHUB);
    });
  });
});
