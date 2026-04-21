import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import {
  mkdtemp,
  rm,
  writeFile,
  mkdir,
  readFile,
  stat,
} from 'fs/promises';
import { writeFileSync } from 'fs';
import { tmpdir } from 'os';

import { runAutomaticVersionBumps } from '../utils/versionBump';
import { NpmTarget } from '../targets/npm';
import { PypiTarget } from '../targets/pypi';
import { CratesTarget } from '../targets/crates';
import { GemTarget } from '../targets/gem';
import { PubDevTarget } from '../targets/pubDev';
import { HexTarget } from '../targets/hex';
import { NugetTarget } from '../targets/nuget';

// Use vi.hoisted to create mock functions that are available during vi.mock hoisting
const { mockSpawnProcess, mockHasExecutable } = vi.hoisted(() => ({
  mockSpawnProcess: vi.fn(),
  mockHasExecutable: vi.fn(),
}));

// Mock spawnProcess and hasExecutable to avoid actually running commands
// We need to mock runWithExecutable as well since it internally calls hasExecutable
// which won't be the mocked version due to how module internals work
vi.mock('../utils/system', async () => {
  const actual =
    await vi.importActual<typeof import('../utils/system')>('../utils/system');

  return {
    ...actual,
    spawnProcess: mockSpawnProcess,
    hasExecutable: mockHasExecutable,
    // Re-implement runWithExecutable to use mocked functions
    runWithExecutable: async (
      config: import('../utils/system').ExecutableConfig,
      args: string[],
      options = {},
    ) => {
      const bin = actual.resolveExecutable(config);
      if (!mockHasExecutable(bin)) {
        const hint = config.errorHint
          ? ` ${config.errorHint}`
          : ' Is it installed?';
        throw new Error(`Cannot find "${bin}".${hint}`);
      }
      return mockSpawnProcess(bin, args, options);
    },
  };
});

// Helper to set up default mocks
function setupDefaultMocks() {
  mockSpawnProcess.mockResolvedValue(Buffer.from(''));
  mockHasExecutable.mockReturnValue(true);
}

describe('runAutomaticVersionBumps', () => {
  let tempDir: string;

  beforeEach(async () => {
    await setupDefaultMocks();
    tempDir = await mkdtemp(join(tmpdir(), 'craft-test-'));
  });

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
    vi.resetAllMocks();
  });

  test('returns empty result when no targets are provided', async () => {
    const result = await runAutomaticVersionBumps([], tempDir, '1.0.0');
    expect(result.anyBumped).toBe(false);
    expect(result.bumpableTargets).toEqual([]);
    expect(result.skippedTargets).toEqual([]);
  });

  test('returns no bumpable targets when target does not support version bumping', async () => {
    // 'github' target doesn't have bumpVersion
    const result = await runAutomaticVersionBumps(
      [{ name: 'github' }],
      tempDir,
      '1.0.0',
    );
    expect(result.anyBumped).toBe(false);
    expect(result.bumpableTargets).toEqual([]);
    expect(result.skippedTargets).toEqual([]);
  });

  test('returns skipped target when target detection fails', async () => {
    // npm target but no package.json
    const result = await runAutomaticVersionBumps(
      [{ name: 'npm' }],
      tempDir,
      '1.0.0',
    );
    expect(result.anyBumped).toBe(false);
    expect(result.bumpableTargets).toEqual(['npm']);
    expect(result.skippedTargets).toEqual(['npm']);
  });

  test('calls bumpVersion for npm target with package.json', async () => {
    await writeFile(
      join(tempDir, 'package.json'),
      JSON.stringify({ name: 'test', version: '0.0.1' }),
    );

    const result = await runAutomaticVersionBumps(
      [{ name: 'npm' }],
      tempDir,
      '1.0.0',
    );

    expect(result.anyBumped).toBe(true);
    expect(result.bumpableTargets).toEqual(['npm']);
    expect(result.skippedTargets).toEqual([]);
  });

  test('deduplicates multiple targets of the same type', async () => {
    await writeFile(
      join(tempDir, 'package.json'),
      JSON.stringify({ name: 'test', version: '0.0.1' }),
    );

    const bumpSpy = vi.spyOn(NpmTarget, 'bumpVersion');

    await runAutomaticVersionBumps(
      [{ name: 'npm' }, { name: 'npm', id: 'second' }],
      tempDir,
      '1.0.0',
    );

    // Should only be called once despite two npm targets
    expect(bumpSpy).toHaveBeenCalledTimes(1);
  });

  test('processes multiple different target types', async () => {
    // Create files for both npm and pypi
    await writeFile(
      join(tempDir, 'package.json'),
      JSON.stringify({ name: 'test', version: '0.0.1' }),
    );
    await writeFile(
      join(tempDir, 'pyproject.toml'),
      '[project]\nname = "test"\nversion = "0.0.1"',
    );

    const npmSpy = vi.spyOn(NpmTarget, 'bumpVersion');
    const pypiSpy = vi.spyOn(PypiTarget, 'bumpVersion');

    const result = await runAutomaticVersionBumps(
      [{ name: 'npm' }, { name: 'pypi' }],
      tempDir,
      '1.0.0',
    );

    expect(result.anyBumped).toBe(true);
    expect(result.bumpableTargets).toEqual(['npm', 'pypi']);
    expect(result.skippedTargets).toEqual([]);
    expect(npmSpy).toHaveBeenCalledTimes(1);
    expect(pypiSpy).toHaveBeenCalledTimes(1);
  });

  test('throws error with context when bumpVersion fails', async () => {
    await writeFile(
      join(tempDir, 'package.json'),
      JSON.stringify({ name: 'test', version: '0.0.1' }),
    );

    vi.spyOn(NpmTarget, 'bumpVersion').mockRejectedValue(
      new Error('npm not found'),
    );

    await expect(
      runAutomaticVersionBumps([{ name: 'npm' }], tempDir, '1.0.0'),
    ).rejects.toThrow(/Automatic version bump failed for "npm" target/);
  });
});

describe('NpmTarget.bumpVersion', () => {
  let tempDir: string;

  beforeEach(async () => {
    await setupDefaultMocks();
    tempDir = await mkdtemp(join(tmpdir(), 'craft-npm-test-'));
  });

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
    vi.resetAllMocks();
  });

  test('returns false when no package.json exists', async () => {
    const result = await NpmTarget.bumpVersion(tempDir, '1.0.0');
    expect(result).toBe(false);
  });

  test('returns true and calls npm version when package.json exists', async () => {
    await writeFile(
      join(tempDir, 'package.json'),
      JSON.stringify({ name: 'test', version: '0.0.1' }),
    );

    const { spawnProcess } = await import('../utils/system');
    const result = await NpmTarget.bumpVersion(tempDir, '1.0.0');

    expect(result).toBe(true);
    expect(spawnProcess).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['version', '1.0.0', '--no-git-tag-version']),
      expect.objectContaining({ cwd: tempDir }),
    );
  });

  describe('workspace:* handling (issue #804)', () => {
    /**
     * Set up a workspace monorepo:
     *   /package.json                        (workspaces: ["packages/*"])
     *   /packages/core/package.json          (@scope/core, version 0.0.1)
     *   /packages/app/package.json           (@scope/app, 0.0.1, deps: core @ workspace:*)
     */
    async function setupWorkspaceRepo(): Promise<{
      rootPkg: string;
      corePkg: string;
      appPkg: string;
    }> {
      const rootPkg = join(tempDir, 'package.json');
      await writeFile(
        rootPkg,
        JSON.stringify({
          name: 'root',
          version: '0.0.1',
          private: true,
          workspaces: ['packages/*'],
        }),
      );

      await mkdir(join(tempDir, 'packages', 'core'), { recursive: true });
      const corePkg = join(tempDir, 'packages', 'core', 'package.json');
      await writeFile(
        corePkg,
        JSON.stringify({
          name: '@scope/core',
          version: '0.0.1',
        }),
      );

      await mkdir(join(tempDir, 'packages', 'app'), { recursive: true });
      const appPkg = join(tempDir, 'packages', 'app', 'package.json');
      await writeFile(
        appPkg,
        JSON.stringify({
          name: '@scope/app',
          version: '0.0.1',
          dependencies: { '@scope/core': 'workspace:*' },
        }),
      );

      return { rootPkg, corePkg, appPkg };
    }

    async function readVersion(pkgPath: string): Promise<string> {
      const raw = await readFile(pkgPath, 'utf-8');
      return JSON.parse(raw).version;
    }

    test('post-check treats npm/cli#8845-style failure as success when files are bumped', async () => {
      const { rootPkg, corePkg, appPkg } = await setupWorkspaceRepo();

      // Simulate `npm version --workspaces`: write the new version to every
      // package.json, then exit non-zero (EUNSUPPORTEDPROTOCOL).
      mockSpawnProcess.mockImplementation(
        async (_bin: string, args: string[], _opts: unknown) => {
          if (args.includes('--workspaces')) {
            writeFileSync(
              rootPkg,
              JSON.stringify({
                name: 'root',
                version: '1.0.0',
                private: true,
                workspaces: ['packages/*'],
              }),
            );
            writeFileSync(
              corePkg,
              JSON.stringify({ name: '@scope/core', version: '1.0.0' }),
            );
            writeFileSync(
              appPkg,
              JSON.stringify({
                name: '@scope/app',
                version: '1.0.0',
                dependencies: { '@scope/core': 'workspace:*' },
              }),
            );
            throw new Error(
              'npm error code EUNSUPPORTEDPROTOCOL\nnpm error Unsupported URL Type "workspace:": workspace:*',
            );
          }
          return Buffer.from('');
        },
      );

      const result = await NpmTarget.bumpVersion(tempDir, '1.0.0');

      expect(result).toBe(true);
      expect(await readVersion(rootPkg)).toBe('1.0.0');
      expect(await readVersion(corePkg)).toBe('1.0.0');
      expect(await readVersion(appPkg)).toBe('1.0.0');

      // Should NOT have fallen back to per-package bumping.
      const workspaceCalls = mockSpawnProcess.mock.calls.filter(call =>
        (call[1] as string[]).includes('--workspaces'),
      );
      expect(workspaceCalls).toHaveLength(1);
      const perPackageCalls = mockSpawnProcess.mock.calls.filter(
        call =>
          !(call[1] as string[]).includes('--workspaces') &&
          (call[2] as { cwd?: string })?.cwd !== tempDir,
      );
      expect(perPackageCalls).toHaveLength(0);
    });

    test('falls back to individual bumping when files are NOT bumped', async () => {
      const { rootPkg, corePkg, appPkg } = await setupWorkspaceRepo();
      const calls: Array<{ cwd: string; args: string[] }> = [];

      mockSpawnProcess.mockImplementation(
        async (_bin: string, args: string[], opts: unknown) => {
          const cwd = (opts as { cwd?: string })?.cwd ?? '';
          calls.push({ cwd, args: [...args] });
          if (args.includes('--workspaces')) {
            // Genuine failure: do NOT write files.
            throw new Error('some other npm error, files unchanged');
          }
          // Per-package call: simulate successful bump by writing version.
          const pkgJsonPath = join(cwd, 'package.json');
          try {
            const raw = JSON.parse(
              require('fs').readFileSync(pkgJsonPath, 'utf-8'),
            );
            raw.version = '1.0.0';
            writeFileSync(pkgJsonPath, JSON.stringify(raw));
          } catch {
            // Root call may run before workspace discovery — ignore.
          }
          return Buffer.from('');
        },
      );

      const result = await NpmTarget.bumpVersion(tempDir, '1.0.0');

      expect(result).toBe(true);
      // Fallback should have hit each public workspace package.
      const perPkgCwds = calls
        .filter(
          c =>
            !c.args.includes('--workspaces') &&
            c.cwd !== tempDir,
        )
        .map(c => c.cwd);
      expect(perPkgCwds).toEqual(
        expect.arrayContaining([
          join(tempDir, 'packages', 'core'),
          join(tempDir, 'packages', 'app'),
        ]),
      );
      expect(await readVersion(rootPkg)).toBe('1.0.0');
      expect(await readVersion(corePkg)).toBe('1.0.0');
      expect(await readVersion(appPkg)).toBe('1.0.0');
    });

    test('per-package bump post-check tolerates npm/cli#8845 and continues', async () => {
      const { rootPkg, corePkg, appPkg } = await setupWorkspaceRepo();

      mockSpawnProcess.mockImplementation(
        async (_bin: string, args: string[], opts: unknown) => {
          const cwd = (opts as { cwd?: string })?.cwd ?? '';
          if (args.includes('--workspaces')) {
            // First failure to force fallback; no file writes.
            throw new Error('files untouched');
          }
          // Per-package: write version but also throw, simulating #8845.
          if (cwd !== tempDir) {
            const pkgJsonPath = join(cwd, 'package.json');
            const raw = JSON.parse(
              require('fs').readFileSync(pkgJsonPath, 'utf-8'),
            );
            raw.version = '1.0.0';
            writeFileSync(pkgJsonPath, JSON.stringify(raw));
            throw new Error('EUNSUPPORTEDPROTOCOL workspace:*');
          }
          // Root call: no-op but succeed.
          return Buffer.from('');
        },
      );

      const result = await NpmTarget.bumpVersion(tempDir, '1.0.0');

      expect(result).toBe(true);
      expect(await readVersion(rootPkg)).toBe('0.0.1'); // root spawn returned buffer, no write
      expect(await readVersion(corePkg)).toBe('1.0.0');
      expect(await readVersion(appPkg)).toBe('1.0.0');
    });

    test('rethrows when per-package bump fails and file is NOT bumped', async () => {
      await setupWorkspaceRepo();

      mockSpawnProcess.mockImplementation(
        async (_bin: string, args: string[], opts: unknown) => {
          const cwd = (opts as { cwd?: string })?.cwd ?? '';
          if (args.includes('--workspaces')) {
            throw new Error('trigger fallback');
          }
          if (cwd !== tempDir) {
            // Per-package: do NOT write, throw — genuine failure.
            throw new Error('real npm failure, e.g. bad version');
          }
          return Buffer.from('');
        },
      );

      await expect(NpmTarget.bumpVersion(tempDir, '1.0.0')).rejects.toThrow(
        'real npm failure',
      );
    });

    test('patches bun.lock workspace versions after successful bump', async () => {
      const { rootPkg, corePkg, appPkg } = await setupWorkspaceRepo();

      const bunLock = `{
  "lockfileVersion": 1,
  "workspaces": {
    "": {
      "name": "root",
    },
    "packages/core": {
      "name": "@scope/core",
      "version": "0.0.1",
    },
    "packages/app": {
      "name": "@scope/app",
      "version": "0.0.1",
      "dependencies": {
        "@scope/core": "workspace:*",
      },
    },
  },
  "packages": {
    "@scope/core": ["@scope/core@0.0.1", "workspace:packages/core"],
  },
}
`;
      await writeFile(join(tempDir, 'bun.lock'), bunLock);

      // Normal spawnProcess: succeed without writing (files get written below).
      mockSpawnProcess.mockImplementation(
        async (_bin: string, args: string[], opts: unknown) => {
          // Simulate a successful npm version bump.
          if (args.includes('--workspaces')) {
            const cwd = (opts as { cwd: string }).cwd;
            for (const p of [rootPkg, corePkg, appPkg]) {
              const raw = JSON.parse(
                require('fs').readFileSync(p, 'utf-8'),
              );
              raw.version = '1.0.0';
              writeFileSync(p, JSON.stringify(raw));
            }
            void cwd;
          }
          return Buffer.from('');
        },
      );

      const result = await NpmTarget.bumpVersion(tempDir, '1.0.0');

      expect(result).toBe(true);
      const patched = await readFile(join(tempDir, 'bun.lock'), 'utf-8');
      // Both workspace entries should have the new version.
      expect(patched).toContain('"packages/core": {');
      expect(patched).toMatch(
        /"packages\/core":\s*\{[\s\S]*?"version":\s*"1\.0\.0"/,
      );
      expect(patched).toMatch(
        /"packages\/app":\s*\{[\s\S]*?"version":\s*"1\.0\.0"/,
      );
      // Nested dependency version pins must stay as "workspace:*".
      expect(patched).toContain('"@scope/core": "workspace:*"');
    });

    test('bun.lock patching is a no-op when file is absent', async () => {
      await setupWorkspaceRepo();

      // No bun.lock created.
      await expect(NpmTarget.bumpVersion(tempDir, '1.0.0')).resolves.toBe(true);
      await expect(
        stat(join(tempDir, 'bun.lock')),
      ).rejects.toHaveProperty('code', 'ENOENT');
    });

    test('bun.lock patching leaves nested dependency version pins untouched', async () => {
      await setupWorkspaceRepo();

      // This time include a concrete version pin inside dependencies to prove
      // the regex is non-greedy and only rewrites the workspace's top-level
      // "version" line.
      const bunLock = `{
  "workspaces": {
    "packages/core": {
      "name": "@scope/core",
      "version": "0.0.1",
      "dependencies": {
        "@other/dep": "0.0.1",
      },
    },
  },
}
`;
      await writeFile(join(tempDir, 'bun.lock'), bunLock);

      await NpmTarget.bumpVersion(tempDir, '2.0.0');

      const patched = await readFile(join(tempDir, 'bun.lock'), 'utf-8');
      // Top-level workspace version bumped.
      expect(patched).toMatch(
        /"packages\/core":\s*\{[\s\S]*?"version":\s*"2\.0\.0"/,
      );
      // Nested dep pin must NOT have been rewritten.
      expect(patched).toContain('"@other/dep": "0.0.1"');
    });
  });
});

describe('PypiTarget.bumpVersion', () => {
  let tempDir: string;

  beforeEach(async () => {
    await setupDefaultMocks();
    tempDir = await mkdtemp(join(tmpdir(), 'craft-pypi-test-'));
  });

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
    vi.resetAllMocks();
  });

  test('returns false when no pyproject.toml exists', async () => {
    const result = await PypiTarget.bumpVersion(tempDir, '1.0.0');
    expect(result).toBe(false);
  });

  test('uses hatch when [tool.hatch] section exists', async () => {
    await writeFile(
      join(tempDir, 'pyproject.toml'),
      '[tool.hatch]\n[project]\nname = "test"',
    );

    const { spawnProcess } = await import('../utils/system');
    const result = await PypiTarget.bumpVersion(tempDir, '1.0.0');

    expect(result).toBe(true);
    expect(spawnProcess).toHaveBeenCalledWith(
      'hatch',
      ['version', '1.0.0'],
      expect.objectContaining({ cwd: tempDir }),
    );
  });

  test('uses poetry when [tool.poetry] section exists', async () => {
    await writeFile(
      join(tempDir, 'pyproject.toml'),
      '[tool.poetry]\nname = "test"',
    );

    const { spawnProcess } = await import('../utils/system');
    const result = await PypiTarget.bumpVersion(tempDir, '1.0.0');

    expect(result).toBe(true);
    expect(spawnProcess).toHaveBeenCalledWith(
      'poetry',
      ['version', '1.0.0'],
      expect.objectContaining({ cwd: tempDir }),
    );
  });

  test('returns true without action for setuptools_scm', async () => {
    await writeFile(
      join(tempDir, 'pyproject.toml'),
      '[tool.setuptools_scm]\n[project]\nname = "test"',
    );

    const { spawnProcess } = await import('../utils/system');
    const result = await PypiTarget.bumpVersion(tempDir, '1.0.0');

    expect(result).toBe(true);
    // Should not call any command for setuptools_scm
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  test('directly edits pyproject.toml when [project] with version exists', async () => {
    const originalContent = '[project]\nname = "test"\nversion = "0.0.1"';
    await writeFile(join(tempDir, 'pyproject.toml'), originalContent);

    const result = await PypiTarget.bumpVersion(tempDir, '1.0.0');

    expect(result).toBe(true);

    const updatedContent = await readFile(
      join(tempDir, 'pyproject.toml'),
      'utf-8',
    );
    expect(updatedContent).toContain('version = "1.0.0"');
  });
});

describe('GemTarget.bumpVersion', () => {
  let tempDir: string;

  beforeEach(async () => {
    await setupDefaultMocks();
    tempDir = await mkdtemp(join(tmpdir(), 'craft-gem-test-'));
  });

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test('returns false when no gemspec exists', async () => {
    const result = await GemTarget.bumpVersion(tempDir, '1.0.0');
    expect(result).toBe(false);
  });

  test('updates version in gemspec file', async () => {
    const gemspecContent = `
Gem::Specification.new do |s|
  s.name = "test"
  s.version = "0.0.1"
end
`;
    await writeFile(join(tempDir, 'test.gemspec'), gemspecContent);

    const result = await GemTarget.bumpVersion(tempDir, '1.0.0');

    expect(result).toBe(true);

    const updatedContent = await readFile(
      join(tempDir, 'test.gemspec'),
      'utf-8',
    );
    expect(updatedContent).toContain('s.version = "1.0.0"');
  });

  test('updates VERSION in lib/**/version.rb', async () => {
    await writeFile(join(tempDir, 'test.gemspec'), 'Gem::Specification.new');
    await mkdir(join(tempDir, 'lib', 'test'), { recursive: true });
    await writeFile(
      join(tempDir, 'lib', 'test', 'version.rb'),
      'module Test\n  VERSION = "0.0.1"\nend',
    );

    const result = await GemTarget.bumpVersion(tempDir, '1.0.0');

    expect(result).toBe(true);

    const updatedContent = await readFile(
      join(tempDir, 'lib', 'test', 'version.rb'),
      'utf-8',
    );
    expect(updatedContent).toContain('VERSION = "1.0.0"');
  });

  test('finds gemspec in subdirectory (monorepo like sentry-ruby)', async () => {
    // Structure: sentry-ruby/sentry-ruby.gemspec
    await mkdir(join(tempDir, 'sentry-ruby'));
    await writeFile(
      join(tempDir, 'sentry-ruby', 'sentry-ruby.gemspec'),
      'Gem::Specification.new do |s|\n  s.version = "0.0.1"\nend',
    );

    const result = await GemTarget.bumpVersion(tempDir, '1.0.0');
    expect(result).toBe(true);

    const content = await readFile(
      join(tempDir, 'sentry-ruby', 'sentry-ruby.gemspec'),
      'utf-8',
    );
    expect(content).toContain('s.version = "1.0.0"');
  });

  test('finds gemspec at depth 2 (packages/gem-name pattern)', async () => {
    await mkdir(join(tempDir, 'packages', 'my-gem'), { recursive: true });
    await writeFile(
      join(tempDir, 'packages', 'my-gem', 'my-gem.gemspec'),
      'Gem::Specification.new do |s|\n  s.version = "0.0.1"\nend',
    );

    const result = await GemTarget.bumpVersion(tempDir, '1.0.0');
    expect(result).toBe(true);

    const content = await readFile(
      join(tempDir, 'packages', 'my-gem', 'my-gem.gemspec'),
      'utf-8',
    );
    expect(content).toContain('s.version = "1.0.0"');
  });

  test('updates version.rb relative to gemspec in subdirectory', async () => {
    // Structure: sentry-ruby/sentry-ruby.gemspec + sentry-ruby/lib/sentry/version.rb
    await mkdir(join(tempDir, 'sentry-ruby', 'lib', 'sentry'), {
      recursive: true,
    });
    await writeFile(
      join(tempDir, 'sentry-ruby', 'sentry-ruby.gemspec'),
      'Gem::Specification.new do |s|\n  s.version = "0.0.1"\nend',
    );
    await writeFile(
      join(tempDir, 'sentry-ruby', 'lib', 'sentry', 'version.rb'),
      'module Sentry\n  VERSION = "0.0.1"\nend',
    );

    const result = await GemTarget.bumpVersion(tempDir, '1.0.0');
    expect(result).toBe(true);

    const versionContent = await readFile(
      join(tempDir, 'sentry-ruby', 'lib', 'sentry', 'version.rb'),
      'utf-8',
    );
    expect(versionContent).toContain('VERSION = "1.0.0"');
  });

  test('skips gemspecs in gitignored directories', async () => {
    await writeFile(join(tempDir, '.gitignore'), 'vendor/\n');
    await mkdir(join(tempDir, 'vendor'));
    await writeFile(
      join(tempDir, 'vendor', 'test.gemspec'),
      'Gem::Specification.new do |s|\n  s.version = "0.0.1"\nend',
    );

    const result = await GemTarget.bumpVersion(tempDir, '1.0.0');
    expect(result).toBe(false);

    // Verify the file was not modified
    const content = await readFile(
      join(tempDir, 'vendor', 'test.gemspec'),
      'utf-8',
    );
    expect(content).toContain('s.version = "0.0.1"');
  });

  test('handles multiple gemspecs in monorepo', async () => {
    // Structure like sentry-ruby with multiple gems
    await mkdir(join(tempDir, 'sentry-ruby'));
    await mkdir(join(tempDir, 'sentry-rails'));
    await writeFile(
      join(tempDir, 'sentry-ruby', 'sentry-ruby.gemspec'),
      'Gem::Specification.new do |s|\n  s.version = "0.0.1"\nend',
    );
    await writeFile(
      join(tempDir, 'sentry-rails', 'sentry-rails.gemspec'),
      'Gem::Specification.new do |s|\n  s.version = "0.0.1"\nend',
    );

    const result = await GemTarget.bumpVersion(tempDir, '1.0.0');
    expect(result).toBe(true);

    const rubyContent = await readFile(
      join(tempDir, 'sentry-ruby', 'sentry-ruby.gemspec'),
      'utf-8',
    );
    const railsContent = await readFile(
      join(tempDir, 'sentry-rails', 'sentry-rails.gemspec'),
      'utf-8',
    );
    expect(rubyContent).toContain('s.version = "1.0.0"');
    expect(railsContent).toContain('s.version = "1.0.0"');
  });
});

describe('PubDevTarget.bumpVersion', () => {
  let tempDir: string;

  beforeEach(async () => {
    await setupDefaultMocks();
    tempDir = await mkdtemp(join(tmpdir(), 'craft-pubdev-test-'));
  });

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test('returns false when no pubspec.yaml exists', async () => {
    const result = await PubDevTarget.bumpVersion(tempDir, '1.0.0');
    expect(result).toBe(false);
  });

  test('updates version in pubspec.yaml', async () => {
    await writeFile(
      join(tempDir, 'pubspec.yaml'),
      'name: test\nversion: 0.0.1\n',
    );

    const result = await PubDevTarget.bumpVersion(tempDir, '1.0.0');

    expect(result).toBe(true);

    const updatedContent = await readFile(
      join(tempDir, 'pubspec.yaml'),
      'utf-8',
    );
    expect(updatedContent).toContain('version: 1.0.0');
  });
});

describe('HexTarget.bumpVersion', () => {
  let tempDir: string;

  beforeEach(async () => {
    await setupDefaultMocks();
    tempDir = await mkdtemp(join(tmpdir(), 'craft-hex-test-'));
  });

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test('returns false when no mix.exs exists', async () => {
    const result = await HexTarget.bumpVersion(tempDir, '1.0.0');
    expect(result).toBe(false);
  });

  test('updates version: in mix.exs', async () => {
    const mixContent = `
defmodule Test.MixProject do
  def project do
    [
      app: :test,
      version: "0.0.1",
    ]
  end
end
`;
    await writeFile(join(tempDir, 'mix.exs'), mixContent);

    const result = await HexTarget.bumpVersion(tempDir, '1.0.0');

    expect(result).toBe(true);

    const updatedContent = await readFile(join(tempDir, 'mix.exs'), 'utf-8');
    expect(updatedContent).toContain('version: "1.0.0"');
  });

  test('updates @version module attribute in mix.exs', async () => {
    const mixContent = `
defmodule Test.MixProject do
  @version "0.0.1"

  def project do
    [app: :test, version: @version]
  end
end
`;
    await writeFile(join(tempDir, 'mix.exs'), mixContent);

    const result = await HexTarget.bumpVersion(tempDir, '1.0.0');

    expect(result).toBe(true);

    const updatedContent = await readFile(join(tempDir, 'mix.exs'), 'utf-8');
    expect(updatedContent).toContain('@version "1.0.0"');
  });
});

describe('NugetTarget.bumpVersion', () => {
  let tempDir: string;

  beforeEach(async () => {
    await setupDefaultMocks();
    tempDir = await mkdtemp(join(tmpdir(), 'craft-nuget-test-'));
  });

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
    vi.resetAllMocks();
  });

  test('returns false when no .csproj exists', async () => {
    const result = await NugetTarget.bumpVersion(tempDir, '1.0.0');
    expect(result).toBe(false);
  });

  test('updates Version in .csproj file', async () => {
    const csprojContent = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <Version>0.0.1</Version>
  </PropertyGroup>
</Project>`;
    await writeFile(join(tempDir, 'Test.csproj'), csprojContent);

    // Mock spawnProcess to fail (no dotnet-setversion) so it falls through to XML edit
    const { spawnProcess } = await import('../utils/system');
    vi.mocked(spawnProcess).mockRejectedValue(new Error('not installed'));

    const result = await NugetTarget.bumpVersion(tempDir, '1.0.0');

    expect(result).toBe(true);

    const updatedContent = await readFile(
      join(tempDir, 'Test.csproj'),
      'utf-8',
    );
    expect(updatedContent).toContain('<Version>1.0.0</Version>');
  });

  test('updates Directory.Build.props if it exists', async () => {
    const buildPropsContent = `<Project>
  <PropertyGroup>
    <Version>0.0.1</Version>
  </PropertyGroup>
</Project>`;
    await writeFile(join(tempDir, 'Directory.Build.props'), buildPropsContent);
    await writeFile(join(tempDir, 'Test.csproj'), '<Project></Project>');

    const { spawnProcess } = await import('../utils/system');
    vi.mocked(spawnProcess).mockRejectedValue(new Error('not installed'));

    const result = await NugetTarget.bumpVersion(tempDir, '1.0.0');

    expect(result).toBe(true);

    const updatedContent = await readFile(
      join(tempDir, 'Directory.Build.props'),
      'utf-8',
    );
    expect(updatedContent).toContain('<Version>1.0.0</Version>');
  });
});

describe('CratesTarget.bumpVersion', () => {
  let tempDir: string;

  beforeEach(async () => {
    await setupDefaultMocks();
    tempDir = await mkdtemp(join(tmpdir(), 'craft-crates-test-'));
  });

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
    vi.resetAllMocks();
  });

  test('returns false when no Cargo.toml exists', async () => {
    const result = await CratesTarget.bumpVersion(tempDir, '1.0.0');
    expect(result).toBe(false);
  });

  test('calls cargo set-version when Cargo.toml exists', async () => {
    await writeFile(
      join(tempDir, 'Cargo.toml'),
      '[package]\nname = "test"\nversion = "0.0.1"',
    );

    const { spawnProcess } = await import('../utils/system');
    const result = await CratesTarget.bumpVersion(tempDir, '1.0.0');

    expect(result).toBe(true);
    expect(spawnProcess).toHaveBeenCalledWith(
      'cargo',
      ['set-version', '1.0.0'],
      expect.objectContaining({ cwd: tempDir }),
    );
  });
});
