import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'fs/promises';
import { tmpdir } from 'os';

import { runAutomaticVersionBumps } from '../utils/versionBump';
import { NpmTarget } from '../targets/npm';
import { PypiTarget } from '../targets/pypi';
import { CratesTarget } from '../targets/crates';
import { GemTarget } from '../targets/gem';
import { PubDevTarget } from '../targets/pubDev';
import { HexTarget } from '../targets/hex';
import { NugetTarget } from '../targets/nuget';

// Store mock functions at module scope so they can be configured in tests
const mockSpawnProcess = vi.fn();
const mockHasExecutable = vi.fn();

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
async function setupDefaultMocks() {
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

  test('returns false when no targets are provided', async () => {
    const result = await runAutomaticVersionBumps([], tempDir, '1.0.0');
    expect(result).toBe(false);
  });

  test('returns false when target does not support version bumping', async () => {
    // 'github' target doesn't have bumpVersion
    const result = await runAutomaticVersionBumps(
      [{ name: 'github' }],
      tempDir,
      '1.0.0',
    );
    expect(result).toBe(false);
  });

  test('returns false when target detection fails', async () => {
    // npm target but no package.json
    const result = await runAutomaticVersionBumps(
      [{ name: 'npm' }],
      tempDir,
      '1.0.0',
    );
    expect(result).toBe(false);
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

    expect(result).toBe(true);
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

    expect(result).toBe(true);
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
