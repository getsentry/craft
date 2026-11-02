import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { updateVersionFiles } from '../versionFiles';

describe('updateVersionFiles', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'craft-version-files-'));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  function write(file: string, content: string): void {
    mkdirSync(dirname(join(repoRoot, file)), { recursive: true });
    writeFileSync(join(repoRoot, file), content);
  }

  function read(file: string): string {
    return readFileSync(join(repoRoot, file), 'utf-8');
  }

  describe('json', () => {
    test('replaces only the version value and keeps the formatting', () => {
      const original =
        '{\n    "name": "mcp",\n    "version": "1.0.0",\n    "files": ["dist", "README.md"]\n}';
      write('packages/mcp/package.json', original);

      const matched = updateVersionFiles(
        [{ path: 'packages/mcp/package.json' }],
        repoRoot,
        '1.1.0-dev.0',
      );

      expect(matched).toEqual(['packages/mcp/package.json']);
      expect(read('packages/mcp/package.json')).toBe(
        original.replace('"1.0.0"', '"1.1.0-dev.0"'),
      );
    });

    test('updates a dotted field', () => {
      write('app.json', '{ "expo": { "version": "1.0.0" }, "version": "x" }\n');

      updateVersionFiles(
        [{ path: 'app.json', field: 'expo.version' }],
        repoRoot,
        '2.0.0',
      );

      expect(read('app.json')).toBe(
        '{ "expo": { "version": "2.0.0" }, "version": "x" }\n',
      );
    });

    test('strips the prerelease and build metadata', () => {
      write('plugin.json', '{ "version": "1.0.0" }\n');

      updateVersionFiles(
        [{ path: 'plugin.json', stripPrerelease: true }],
        repoRoot,
        '1.2.0-dev.0+abc',
      );

      expect(read('plugin.json')).toBe('{ "version": "1.2.0" }\n');
    });

    test('fails when the field is missing or not a string', () => {
      write('a.json', '{ "name": "a" }');
      write('b.json', '{ "version": 1 }');

      expect(() =>
        updateVersionFiles([{ path: 'a.json' }], repoRoot, '1.0.0'),
      ).toThrow('a.json has no string "version" field to update.');
      expect(() =>
        updateVersionFiles([{ path: 'b.json' }], repoRoot, '1.0.0'),
      ).toThrow('b.json has no string "version" field to update.');
    });

    test('fails on invalid JSON', () => {
      write('a.json', '{ "version": "1.0.0", // comment\n}');

      expect(() =>
        updateVersionFiles([{ path: 'a.json' }], repoRoot, '1.0.0'),
      ).toThrow('a.json is not valid JSON.');
    });
  });

  describe('frontmatter', () => {
    test('updates every globbed file and keeps quotes and comments', () => {
      write(
        'skills/cli/SKILL.md',
        '---\nname: cli\nversion: 1.0.0\n---\n\nversion: 1.0.0 in the body\n',
      );
      write(
        'skills/cli/references/api.md',
        '---\r\nversion: "1.0.0" # generated\r\nmetadata:\r\n  version: 9\r\n---\r\n',
      );

      const matched = updateVersionFiles(
        [{ path: 'skills/**/*.md' }],
        repoRoot,
        '1.1.0',
      );

      expect(matched).toEqual([
        'skills/cli/SKILL.md',
        'skills/cli/references/api.md',
      ]);
      expect(read('skills/cli/SKILL.md')).toBe(
        '---\nname: cli\nversion: 1.1.0\n---\n\nversion: 1.0.0 in the body\n',
      );
      expect(read('skills/cli/references/api.md')).toBe(
        '---\r\nversion: "1.1.0" # generated\r\nmetadata:\r\n  version: 9\r\n---\r\n',
      );
    });

    test('fails without exactly one top-level key', () => {
      write('none.md', '---\nmetadata:\n  version: 1\n---\n');
      write('twice.md', '---\nversion: 1\nversion: 2\n---\n');
      write('plain.md', '# No frontmatter\nversion: 1\n');

      expect(() =>
        updateVersionFiles([{ path: 'none.md' }], repoRoot, '1.0.0'),
      ).toThrow('none.md has no single "version" value to update.');
      expect(() =>
        updateVersionFiles([{ path: 'twice.md' }], repoRoot, '1.0.0'),
      ).toThrow('twice.md has no single "version" value to update.');
      expect(() =>
        updateVersionFiles([{ path: 'plain.md' }], repoRoot, '1.0.0'),
      ).toThrow('plain.md has no YAML frontmatter.');
    });
  });

  describe('toml', () => {
    test('updates the manifest key the target would bump', () => {
      const cargo =
        '[package]\nname = "cli"\nversion = "1.0.0" # bumped\n\n[dependencies]\nserde = { version = "1.0.0" }\n';
      const pyproject =
        "[build-system]\nrequires = ['hatchling']\n\n[project]\nname = 'sdk'\nversion = '1.0.0'\n";
      write('crates/cli/Cargo.toml', cargo);
      write('python/pyproject.toml', pyproject);

      updateVersionFiles(
        [{ path: 'crates/*/Cargo.toml' }, { path: 'python/pyproject.toml' }],
        repoRoot,
        '1.1.0',
      );

      expect(read('crates/cli/Cargo.toml')).toBe(
        cargo.replace('version = "1.0.0" #', 'version = "1.1.0" #'),
      );
      expect(read('python/pyproject.toml')).toBe(
        pyproject.replace("version = '1.0.0'", "version = '1.1.0'"),
      );
    });

    test('updates a dotted field and ignores arrays of tables', () => {
      const content =
        '[[bin]]\nversion = "x"\n\n[tool.poetry]\nversion = "1.0.0"\n';
      write('pyproject.toml', content);

      updateVersionFiles(
        [{ path: 'pyproject.toml', field: 'tool.poetry.version' }],
        repoRoot,
        '2.0.0',
      );

      expect(read('pyproject.toml')).toBe(content.replace('1.0.0', '2.0.0'));
    });

    test('fails when the key is not a string', () => {
      write('Cargo.toml', '[package]\nversion.workspace = true\n');

      expect(() =>
        updateVersionFiles([{ path: 'Cargo.toml' }], repoRoot, '1.0.0'),
      ).toThrow('Cargo.toml has no single "package.version" value to update.');
    });
  });

  describe('yaml', () => {
    test('updates a nested key and keeps comments', () => {
      const content = [
        'name: app',
        'version: 1.0.0+1 # pub version',
        'description: |',
        '  version: not this',
        'dependencies:',
        '  - version: not this either',
        'app:',
        '  version: "1.0.0"',
        '',
      ].join('\n');
      write('pubspec.yaml', content);

      updateVersionFiles(
        [
          { path: 'pubspec.yaml' },
          { path: 'pubspec.yaml', field: 'app.version' },
        ],
        repoRoot,
        '1.1.0',
      );

      expect(read('pubspec.yaml')).toBe(
        content.replace('1.0.0+1 #', '1.1.0 #').replace('"1.0.0"', '"1.1.0"'),
      );
    });
  });

  describe('target formats', () => {
    test('msbuild updates version properties like the nuget target', () => {
      write(
        'src/Sdk/Sdk.csproj',
        '<Project>\n  <PropertyGroup>\n    <VersionPrefix>1.0.0</VersionPrefix>\n    <VersionSuffix>dev</VersionSuffix>\n  </PropertyGroup>\n</Project>\n',
      );

      updateVersionFiles([{ path: 'src/**/*.csproj' }], repoRoot, '1.1.0');

      expect(read('src/Sdk/Sdk.csproj')).toBe(
        '<Project>\n  <PropertyGroup>\n    <VersionPrefix>1.1.0</VersionPrefix>\n    <VersionSuffix></VersionSuffix>\n  </PropertyGroup>\n</Project>\n',
      );
    });

    test('gem updates gemspecs and version.rb like the gem target', () => {
      write(
        'sdk.gemspec',
        'Gem::Specification.new do |s|\n  s.version = "1.0.0"\nend\n',
      );
      write('lib/sdk/version.rb', "module Sdk\n  VERSION = '1.0.0'\nend\n");

      updateVersionFiles(
        [{ path: '*.gemspec' }, { path: 'lib/**/version.rb' }],
        repoRoot,
        '1.1.0',
      );

      expect(read('sdk.gemspec')).toContain('s.version = "1.1.0"');
      expect(read('lib/sdk/version.rb')).toContain("VERSION = '1.1.0'");
    });

    test('mix updates mix.exs like the hex target', () => {
      write(
        'mix.exs',
        'defmodule Sdk.MixProject do\n  @version "1.0.0"\n  def project, do: [version: @version]\nend\n',
      );

      updateVersionFiles([{ path: 'mix.exs' }], repoRoot, '1.1.0');

      expect(read('mix.exs')).toContain('@version "1.1.0"');
    });

    test('fails when a target format finds no version', () => {
      write('Directory.Build.props', '<Project />');

      expect(() =>
        updateVersionFiles(
          [{ path: 'Directory.Build.props' }],
          repoRoot,
          '1.0.0',
        ),
      ).toThrow('Directory.Build.props has no version to update.');
    });
  });

  describe('regex', () => {
    test('replaces the capturing group of every match', () => {
      write(
        'sdk/_version.py',
        '__version__ = "1.0.0"\nVERSION = __version__\n__version__ = "1.0.0"\n',
      );

      updateVersionFiles(
        [
          {
            path: 'sdk/_version.py',
            format: 'regex',
            pattern: '/__version__ = "([^"]+)"/',
          },
        ],
        repoRoot,
        '1.1.0',
      );

      expect(read('sdk/_version.py')).toBe(
        '__version__ = "1.1.0"\nVERSION = __version__\n__version__ = "1.1.0"\n',
      );
    });

    test('fails when the pattern does not match', () => {
      write('version.txt', 'nothing here');

      expect(() =>
        updateVersionFiles(
          [{ path: 'version.txt', format: 'regex', pattern: '/v=(\\S+)/' }],
          repoRoot,
          '1.0.0',
        ),
      ).toThrow('version.txt has no match for /v=(\\S+)/ to update.');
    });
  });

  test('fails when a path matches no files', () => {
    expect(() =>
      updateVersionFiles([{ path: 'missing/*.json' }], repoRoot, '1.0.0'),
    ).toThrow('"missing/*.json" does not match any files.');
  });

  test('ignores symlinks that resolve outside the repository', () => {
    const outside = mkdtempSync(join(tmpdir(), 'craft-version-outside-'));
    try {
      writeFileSync(join(outside, 'package.json'), '{ "version": "1.0.0" }');
      symlinkSync(outside, join(repoRoot, 'linked'));

      expect(() =>
        updateVersionFiles([{ path: 'linked/*.json' }], repoRoot, '2.0.0'),
      ).toThrow('does not match any files');
      expect(readFileSync(join(outside, 'package.json'), 'utf-8')).toBe(
        '{ "version": "1.0.0" }',
      );
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test('writes nothing when a later entry fails', () => {
    write('a.json', '{ "version": "1.0.0" }');

    expect(() =>
      updateVersionFiles(
        [{ path: 'a.json' }, { path: 'missing.json' }],
        repoRoot,
        '2.0.0',
      ),
    ).toThrow('does not match any files');
    expect(read('a.json')).toBe('{ "version": "1.0.0" }');
  });

  test('applies several entries for the same file in order', () => {
    write('package.json', '{ "version": "1.0.0", "x": { "v": "1.0.0" } }');

    updateVersionFiles(
      [
        { path: 'package.json' },
        { path: 'package.json', field: 'x.v', stripPrerelease: true },
      ],
      repoRoot,
      '2.0.0-rc.1',
    );

    expect(read('package.json')).toBe(
      '{ "version": "2.0.0-rc.1", "x": { "v": "2.0.0" } }',
    );
  });
});
