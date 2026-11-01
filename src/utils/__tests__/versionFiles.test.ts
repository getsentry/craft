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
      write('none.md', '---\nname: x\n  version: 1\n---\n');
      write('twice.md', '---\nversion: 1\nversion: 2\n---\n');
      write('plain.md', '# No frontmatter\nversion: 1\n');

      expect(() =>
        updateVersionFiles([{ path: 'none.md' }], repoRoot, '1.0.0'),
      ).toThrow('found 0');
      expect(() =>
        updateVersionFiles([{ path: 'twice.md' }], repoRoot, '1.0.0'),
      ).toThrow('found 2');
      expect(() =>
        updateVersionFiles([{ path: 'plain.md' }], repoRoot, '1.0.0'),
      ).toThrow('plain.md has no YAML frontmatter.');
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
