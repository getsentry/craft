import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, expect, test } from 'vitest';

const directories: string[] = [];
const platforms = [
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64',
  'linux-x64',
  'win-x64',
];
const packageScript = join(__dirname, '../../package-binaries.mjs');

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'craft-package-binaries-'));
  directories.push(directory);
  mkdirSync(join(directory, 'dist-bin'));
  return directory;
}

test('packages all cross-built binaries with checksums of the shipped bytes', () => {
  const directory = fixture();
  for (const platform of platforms) {
    const filename = `craft-${platform}${platform === 'win-x64' ? '.exe' : ''}`;
    writeFileSync(join(directory, 'dist-bin', filename), Buffer.from(platform));
  }
  const result = spawnSync(process.execPath, [packageScript], {
    cwd: directory,
    encoding: 'utf8',
  });
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  for (const platform of platforms) {
    const filename = `craft-${platform}${platform === 'win-x64' ? '.exe' : '.gz'}`;
    const contents = readFileSync(join(directory, 'dist-bin', filename));
    expect(platform === 'win-x64' ? contents : gunzipSync(contents)).toEqual(
      Buffer.from(platform),
    );
    expect(
      readFileSync(join(directory, 'dist-bin', `${filename}.sha256`), 'utf8'),
    ).toBe(
      `${createHash('sha256').update(contents).digest('hex')}  ${filename}\n`,
    );
  }
});

test('fails packaging when a cross-built platform is missing', () => {
  const directory = fixture();
  const result = spawnSync(process.execPath, [packageScript], {
    cwd: directory,
    encoding: 'utf8',
  });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('ENOENT');
  expect(result.stderr).toContain('dist-bin/craft-darwin-arm64');
});
