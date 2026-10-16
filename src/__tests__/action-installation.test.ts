import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  chmodSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { afterEach, expect, test } from 'vitest';

const directories: string[] = [];
const quote = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
afterEach(() => {
  for (const dir of directories.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
function fixture(platform = 'linux', arch = 'x64', native = true) {
  const dir = mkdtempSync(join(tmpdir(), 'craft action install '));
  directories.push(dir);
  const tools = join(dir, 'tools');
  const bin = join(dir, 'bin');
  const archive = join(dir, 'archive');
  const calls = join(dir, 'calls');
  const pathFile = join(dir, 'github-path');
  const metadata = join(dir, 'release.json');
  const asset = `craft-${platform}-${arch}${platform === 'win' ? '.exe' : '.gz'}`;
  const binary = join(
    bin,
    platform === 'win' && native ? 'craft.exe' : 'craft',
  );
  const bytes = Buffer.from(
    `#!/bin/bash\nif [[ "$1" == --version ]]; then echo 2.35.0; else touch ${quote(join(dir, 'setup-called'))}; fi\n`,
  );
  mkdirSync(tools);
  writeFileSync(archive, platform === 'win' ? bytes : gzipSync(bytes));
  writeFileSync(calls, '');
  writeFileSync(pathFile, '');
  writeFileSync(
    metadata,
    JSON.stringify({
      tag_name: '2.35.0',
      draft: false,
      assets: (native ? [asset, 'craft'] : ['craft']).map(name => ({
        name,
        state: 'uploaded',
      })),
    }),
  );
  const script = (name: string, source: string) => {
    writeFileSync(join(tools, name), `#!/bin/bash\n${source}\n`);
    chmodSync(join(tools, name), 0o755);
  };
  script(
    'node',
    `if [[ "$1" == -p ]]; then
  if [[ "$2" == process.arch ]]; then echo ${quote(arch)}; else echo ${quote(platform)}; fi
else
  [[ "$1" == */download-craft-nightly.mjs ]] || exit 19
  printf '%s\\n' "$2" >> ${quote(calls)}
  printf '%s' ${quote(bytes.toString())} > "$3"
fi`,
  );
  script(
    'uname',
    `if [[ "$1" == -s ]]; then echo ${quote(platform === 'win' ? 'MINGW64_NT' : platform === 'darwin' ? 'Darwin' : 'Linux')}; else echo ${quote(arch === 'arm64' ? 'aarch64' : 'x86_64')}; fi`,
  );
  script('codesign', 'exit 0');
  script(
    'gh',
    `printf '%s\\n' "$2" >> ${quote(calls)}
cat ${quote(metadata)}`,
  );
  script(
    'curl',
    `output=''
url=''
while (( $# )); do case "$1" in -o) output="$2"; shift ;; https:*) url="$1" ;; esac; shift; done
printf '%s\\n' "$url" >> ${quote(calls)}
case "$url" in
  https://github.com/getsentry/craft/releases/download/2.35.0/${asset}) cp ${quote(archive)} "$output" ;;
  https://github.com/getsentry/craft/releases/download/2.35.0/craft) printf '%s' ${quote(bytes.toString())} > "$output" ;;
  *) exit 22 ;;
esac`,
  );
  const run = (version = '2.35.0', extra: NodeJS.ProcessEnv = {}) =>
    spawnSync(
      'bash',
      [resolve('.github/scripts/install-craft.sh'), version, bin],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${tools}:${process.env.PATH}`,
          GITHUB_PATH: pathFile,
          CRAFT_NATIVE_ARTIFACT_DIRECTORY: '',
          CRAFT_LEGACY_ARTIFACT: '',
          CRAFT_ARTIFACT_VERSION: '',
          CRAFT_DRY_RUN: '',
          DRY_RUN: '',
          NODE_OPTIONS: '',
          ...extra,
        },
      },
    );
  return {
    dir,
    bin,
    binary,
    archive,
    asset,
    calls,
    pathFile,
    bytes,
    metadata,
    script,
    run,
  };
}

test.each([
  ['linux', 'x64'],
  ['linux', 'arm64'],
  ['darwin', 'x64'],
  ['darwin', 'arm64'],
  ['win', 'x64'],
])(
  'uses the shared installer for the %s/%s native release without setup',
  (platform, arch) => {
    const f = fixture(platform, arch);
    const result = f.run();
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(readFileSync(f.binary)).toEqual(f.bytes);
    expect(existsSync(join(f.dir, 'setup-called'))).toBe(false);
    expect(readFileSync(f.pathFile, 'utf8')).toBe(`${f.bin}\n`);
  },
);

test('latest resolves once and installs the exact selected native release', () => {
  const f = fixture();
  expect(f.run('latest').status).toBe(0);
  expect(readFileSync(f.binary)).toEqual(f.bytes);
  expect(readFileSync(f.calls, 'utf8')).toBe(
    'repos/getsentry/craft/releases/latest\nhttps://github.com/getsentry/craft/releases/download/2.35.0/craft-linux-x64.gz\n',
  );
});

test('old releases retain the JavaScript compatibility path', () => {
  const f = fixture('linux', 'x64', false);
  expect(f.run().status).toBe(0);
  expect(readFileSync(f.binary)).toEqual(f.bytes);
});

test('same-run native artifacts use the shared verifier without network requests', () => {
  const f = fixture();
  const artifacts = join(f.dir, 'artifacts');
  mkdirSync(artifacts);
  writeFileSync(join(artifacts, f.asset), readFileSync(f.archive));
  const result = f.run('latest', {
    CRAFT_NATIVE_ARTIFACT_DIRECTORY: artifacts,
    CRAFT_ARTIFACT_VERSION: '2.35.0',
  });
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  expect(readFileSync(f.binary)).toEqual(f.bytes);
  expect(readFileSync(f.calls, 'utf8')).toBe('');
});

test('invalid native downloads fail without replacing the existing binary or falling back', () => {
  const f = fixture();
  writeFileSync(f.archive, gzipSync(Buffer.from('#!/bin/bash\necho 1.0.0\n')));
  mkdirSync(f.bin);
  writeFileSync(f.binary, 'old');
  const result = f.run();
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('expected 2.35.0');
  expect(readFileSync(f.binary, 'utf8')).toBe('old');
  expect(readFileSync(f.pathFile, 'utf8')).toBe('');
});

test('same-run JavaScript artifacts remain available without network requests', () => {
  const f = fixture();
  const legacy = join(f.dir, 'craft');
  writeFileSync(legacy, f.bytes);
  expect(f.run('latest', { CRAFT_LEGACY_ARTIFACT: legacy }).status).toBe(0);
  expect(readFileSync(f.binary)).toEqual(f.bytes);
  expect(readFileSync(f.calls, 'utf8')).toBe('');
});

test('an unavailable pinned release never falls back to latest', () => {
  const f = fixture();
  f.script('gh', 'exit 1');
  expect(f.run('2.34.1').status).not.toBe(0);
  expect(existsSync(f.binary)).toBe(false);
  expect(readFileSync(f.pathFile, 'utf8')).toBe('');
});

test('an exact nightly uses the existing GHCR downloader without release requests', () => {
  const f = fixture();
  const tag = `nightly-${'a'.repeat(40)}`;
  const result = f.run(tag);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  expect(readFileSync(f.binary)).toEqual(f.bytes);
  expect(readFileSync(f.calls, 'utf8')).toBe(`${tag}\n`);
});

test('release metadata must match the requested version', () => {
  const f = fixture();
  expect(f.run('2.34.1').status).not.toBe(0);
  expect(existsSync(f.binary)).toBe(false);
});

test('release dry-run settings still provision the Craft executable', () => {
  const f = fixture();
  expect(
    f.run('2.35.0', { CRAFT_DRY_RUN: 'true', DRY_RUN: 'true' }).status,
  ).toBe(0);
  expect(readFileSync(f.binary)).toEqual(f.bytes);
  expect(existsSync(join(f.dir, 'setup-called'))).toBe(false);
});

test('duplicate native assets fail instead of using the legacy executable', () => {
  const f = fixture();
  writeFileSync(
    f.metadata,
    JSON.stringify({
      tag_name: '2.35.0',
      draft: false,
      assets: [f.asset, f.asset, 'craft'].map(name => ({
        name,
        state: 'uploaded',
      })),
    }),
  );
  const result = f.run();
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('Duplicate Craft native asset');
  expect(existsSync(f.binary)).toBe(false);
});

test('legacy installation refuses a directory destination without copying into it', () => {
  const f = fixture('linux', 'x64', false);
  mkdirSync(f.binary, { recursive: true });
  expect(f.run().status).not.toBe(0);
  expect(existsSync(join(f.binary, 'craft'))).toBe(false);
});
