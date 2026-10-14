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
import { createHash } from 'node:crypto';
import { afterEach, expect, test } from 'vitest';

const directories: string[] = [];
const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
afterEach(() => {
  for (const dir of directories.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
function fixture(
  badChecksum = false,
  downloadFails = false,
  extraEnv: NodeJS.ProcessEnv = {},
) {
  const dir = mkdtempSync(join(tmpdir(), 'craft bootstrap '));
  directories.push(dir);
  const bin = join(dir, 'tools');
  const destination = join(dir, 'installed');
  mkdirSync(bin);
  const archive = join(dir, 'archive.gz');
  const checksum = join(dir, 'checksum');
  const candidate = Buffer.from(
    '#!/bin/bash\nif [[ "$1" == --version ]]; then echo 9.1.0; exit; fi\nmkdir -p "$CRAFT_INSTALL_DIR"\ncp "$0" "$CRAFT_INSTALL_DIR/craft"\n',
  );
  const data = gzipSync(candidate);
  writeFileSync(archive, data);
  writeFileSync(
    checksum,
    `${badChecksum ? '0'.repeat(64) : createHash('sha256').update(data).digest('hex')}  craft-linux-x64.gz\n`,
  );
  const curl = join(bin, 'curl');
  writeFileSync(
    curl,
    `#!/bin/bash\n${downloadFails ? 'exit 22\n' : ''}output=''\nurl=''\nwhile (( $# )); do case "$1" in -o) output="$2"; shift ;; https:*) url="$1" ;; esac; shift; done\ncase "$url" in */latest) echo https://github.com/getsentry/craft/releases/tag/9.1.0 ;; *.sha256) cp ${quote(checksum)} "$output" ;; *.gz) cp ${quote(archive)} "$output" ;; *) exit 22 ;; esac\n`,
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
        NODE_OPTIONS: '',
        CRAFT_DRY_RUN: '',
        DRY_RUN: '',
        ...extraEnv,
      },
    });
  return { destination, run };
}
test.skipIf(process.platform === 'win32')(
  'installs a checksum-verified pinned release through the native helper',
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
  'checksum failure preserves an existing executable',
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
