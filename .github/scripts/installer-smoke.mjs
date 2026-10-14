// Bootstrap the real shipped artifact with an isolated curl fixture on every OS.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  chmod,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const execute = promisify(execFile);
const quote = value => `'${value.replace(/'/g, "'\\''")}'`;
const shellPath = value => value.replace(/\\/g, '/');
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const platform = `${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`;
const asset = `craft-${platform}${process.platform === 'win32' ? '.exe' : '.gz'}`;
const root = await mkdtemp(join(tmpdir(), 'craft installer smoke '));
try {
  const tools = join(root, 'tools');
  await mkdir(tools);
  const archive = shellPath(resolve('dist-bin', asset));
  const sidecar = join(root, 'checksum');
  await writeFile(sidecar, await readFile(`${archive}.sha256`));
  const curl = join(tools, 'curl');
  await writeFile(
    curl,
    `#!/bin/bash
output=''
url=''
while (( $# )); do case "$1" in -o) output="$2"; shift ;; https:*) url="$1" ;; esac; shift; done
case "$url" in
  https://github.com/getsentry/craft/releases/download/${pkg.version}/${asset}.sha256) cp ${quote(shellPath(sidecar))} "$output" ;;
  https://github.com/getsentry/craft/releases/download/${pkg.version}/${asset}) cp ${quote(archive)} "$output" ;;
  *) echo "Unexpected fixture request: $url" >&2; exit 22 ;;
esac
`,
  );
  await chmod(curl, 0o755);
  const destination = join(root, 'user bin');
  const binary = join(
    destination,
    process.platform === 'win32' ? 'craft.exe' : 'craft',
  );
  const run = async (...args) =>
    execute(
      'bash',
      [
        '-c',
        `export PATH=${quote(shellPath(tools))}:"$PATH"; exec bash ${quote(shellPath(resolve('install')))} "$@"`,
        'installer',
        '--version',
        pkg.version,
        '--install-dir',
        shellPath(destination),
        ...args,
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          NODE_OPTIONS: '',
          CRAFT_WORKSPACE: '',
          CRAFT_CONFIG: '',
          CRAFT_VERSION: '',
          CRAFT_DRY_RUN: '',
        },
        timeout: 180000,
      },
    );
  await run('--dry-run');
  await assert.rejects(readFile(binary), { code: 'ENOENT' });
  await run();
  assert.equal(
    (await execute(binary, ['--version'], { cwd: root })).stdout.trim(),
    pkg.version,
  );
  const installed = await readFile(binary);
  await writeFile(sidecar, `${'0'.repeat(64)}  ${asset}\n`);
  await assert.rejects(run(), /Checksum mismatch/);
  assert.deepEqual(await readFile(binary), installed);
  console.log(
    `Verified native bootstrap and checksum failure preservation: ${platform}`,
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
