import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  chmodSync,
  existsSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { afterEach, expect, test } from 'vitest';

const directories: string[] = [];
const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
afterEach(() => {
  for (const dir of directories.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
function fixture(
  badArchive = false,
  downloadFails = false,
  extraEnv: NodeJS.ProcessEnv = {},
  displayedVersion = '9.1.0',
) {
  const dir = mkdtempSync(join(tmpdir(), 'craft bootstrap '));
  directories.push(dir);
  const bin = join(dir, 'tools');
  const destination = join(dir, 'installed');
  mkdirSync(bin);
  const archive = join(dir, 'archive.gz');
  const candidate = Buffer.from(
    '#!/bin/bash\nif [[ "$1" == --version ]]; then echo ' +
      quote(displayedVersion) +
      '; exit; fi\nprintf setup > ' +
      quote(join(dir, 'setup-called')) +
      '\nmkdir -p "$CRAFT_INSTALL_DIR"\ncp "$0" "$CRAFT_INSTALL_DIR/craft"\n',
  );
  const data = badArchive
    ? Buffer.from('invalid gzip archive')
    : gzipSync(candidate);
  writeFileSync(archive, data);
  const curl = join(bin, 'curl');
  writeFileSync(
    curl,
    `#!/bin/bash\n${downloadFails ? 'exit 22\n' : ''}output=''\nurl=''\nwhile (( $# )); do case "$1" in -o) output="$2"; shift ;; https:*) url="$1" ;; esac; shift; done\ncase "$url" in */latest) echo https://github.com/getsentry/craft/releases/tag/9.1.0 ;; *.gz) cp ${quote(archive)} "$output"; printf 200 ;; *) exit 22 ;; esac\n`,
  );
  const uname = join(bin, 'uname');
  writeFileSync(
    uname,
    '#!/bin/bash\nif [[ "$1" == -s ]]; then echo Linux; else echo x86_64; fi\n',
  );
  chmodSync(curl, 0o755);
  chmodSync(uname, 0o755);
  const run = (...args: string[]) =>
    spawnSync('bash', [resolve('install').replace(/\\/g, '/'), ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        CRAFT_INSTALL_DIR: destination,
        CRAFT_VERSION: '',
        CI: '',
        GITHUB_ACTIONS: '',
        NODE_OPTIONS: '',
        CRAFT_DRY_RUN: '',
        DRY_RUN: '',
        ...extraEnv,
      },
    });
  return { destination, run, archive, dir };
}
test.skipIf(process.platform === 'win32')(
  'installs a pinned HTTPS release without requesting checksum files',
  () => {
    const { destination, run } = fixture();
    const result = run('--version', '9.1.0');
    expect(result.status).toBe(0);
    expect(readFileSync(join(destination, 'craft'), 'utf8')).toContain('9.1.0');
  },
);
test.skipIf(process.platform === 'win32')(
  'resolves latest once and installs the same version',
  () => {
    const { destination, run } = fixture();
    expect(run().status).toBe(0);
    expect(existsSync(join(destination, 'craft'))).toBe(true);
  },
);
test.skipIf(process.platform === 'win32')(
  'invalid archive preserves an existing executable',
  () => {
    const { destination, run } = fixture(true);
    mkdirSync(destination);
    writeFileSync(join(destination, 'craft'), 'old');
    expect(run('--version', '9.1.0').status).not.toBe(0);
    expect(readFileSync(join(destination, 'craft'), 'utf8')).toBe('old');
  },
);
test.skipIf(process.platform === 'win32')(
  'rejects malformed versions and unknown options before installation',
  () => {
    const { destination, run } = fixture();
    expect(run('--version', '../../malicious').stderr).toContain(
      'Invalid version',
    );
    expect(run('--unexpected').stderr).toContain('Unknown option');
    expect(existsSync(destination)).toBe(false);
  },
);
test.skipIf(process.platform === 'win32')(
  'a dry run does not create the installation directory',
  () => {
    const { destination, run } = fixture();
    expect(run('--version', '9.1.0', '--dry-run').status).toBe(0);
    expect(existsSync(destination)).toBe(false);
  },
);

test.skipIf(process.platform === 'win32')(
  'download failure never executes the candidate or changes the destination',
  () => {
    const { destination, run } = fixture(false, true);
    mkdirSync(destination);
    writeFileSync(join(destination, 'craft'), 'old');
    expect(run('--version', '9.1.0').status).not.toBe(0);
    expect(readFileSync(join(destination, 'craft'), 'utf8')).toBe('old');
  },
);

test.each(['CRAFT_DRY_RUN', 'DRY_RUN'])(
  'honors %s before any download or staging',
  name => {
    const { destination, run } = fixture(false, true, {
      CRAFT_DRY_RUN: undefined,
      [name]: 'true',
    });
    const result = run('--version', '9.1.0');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Would install');
    expect(existsSync(destination)).toBe(false);
  },
);

test('accepts Craft version output containing the CI commit SHA', () => {
  const { run } = fixture(false, false, {}, `9.1.0 (${'a'.repeat(40)})`);
  expect(run('--version', '9.1.0').status).toBe(0);
});

test.skipIf(process.platform === 'win32')(
  'a mismatched downloaded version preserves an existing executable',
  () => {
    const { destination, run } = fixture(false, false, {}, '8.0.0');
    mkdirSync(destination);
    writeFileSync(join(destination, 'craft'), 'old');
    expect(run('--version', '9.1.0').status).not.toBe(0);
    expect(readFileSync(join(destination, 'craft'), 'utf8')).toBe('old');
  },
);

test.skipIf(process.platform === 'win32')(
  'a local native archive installs offline through the same verifier',
  () => {
    const { destination, run, archive, dir } = fixture(false, true, {
      CI: 'true',
    });
    const result = run('--version', '9.1.0', '--archive', archive);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(readFileSync(join(destination, 'craft'), 'utf8')).toContain('9.1.0');
    expect(existsSync(join(dir, 'setup-called'))).toBe(false);
  },
);

test.skipIf(process.platform === 'win32')(
  'CI rejects a mismatched archive without replacing an existing executable',
  () => {
    const { destination, run, archive } = fixture(
      false,
      true,
      { CI: 'true' },
      '8.0.0',
    );
    mkdirSync(destination);
    writeFileSync(join(destination, 'craft'), 'old');
    const result = run('--version', '9.1.0', '--archive', archive);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('expected 9.1.0');
    expect(readFileSync(join(destination, 'craft'), 'utf8')).toBe('old');
  },
);

test('a local archive requires an explicit version instead of fetching latest', () => {
  const { run, archive, destination } = fixture(false, true);
  const result = run('--archive', archive);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('--archive requires --version');
  expect(existsSync(destination)).toBe(false);
});

test('CI defaults to the runner temporary bin directory', () => {
  const environment: NodeJS.ProcessEnv = { CI: 'true', CRAFT_INSTALL_DIR: '' };
  const { run, dir } = fixture(false, false, environment);
  environment.RUNNER_TEMP = dir;
  expect(run('--version', '9.1.0').status).toBe(0);
  expect(existsSync(join(dir, 'bin', 'craft'))).toBe(true);
  expect(existsSync(join(dir, 'setup-called'))).toBe(false);
});

test.each(['GITHUB_ACTIONS', 'CI'])(
  '%s automatically installs the executable without shell or agent setup',
  name => {
    const { run, destination, dir } = fixture(false, false, { [name]: 'true' });
    const result = run('--version', '9.1.0');
    expect(result.status).toBe(0);
    expect(readFileSync(join(destination, 'craft'), 'utf8')).toContain('9.1.0');
    expect(existsSync(join(dir, 'setup-called'))).toBe(false);
  },
);

test('interactive installation still runs shell and agent setup', () => {
  const { run, dir } = fixture();
  expect(run('--version', '9.1.0').status).toBe(0);
  expect(existsSync(join(dir, 'setup-called'))).toBe(true);
});

test.each(['false', '0', 'no'])(
  'CI flags set to %s preserve interactive setup',
  value => {
    const { run, dir } = fixture(false, false, {
      CI: value,
      GITHUB_ACTIONS: value,
    });
    expect(run('--version', '9.1.0').status).toBe(0);
    expect(existsSync(join(dir, 'setup-called'))).toBe(true);
  },
);
