// Execute the shipped native and npm artifacts outside the checkout.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  copyFile,
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { x } from 'tar';

const execute = promisify(execFile);
const platform = `${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`;
const filename = `craft-${platform}${process.platform === 'win32' ? '.exe' : ''}`;
const root = await mkdtemp(join(tmpdir(), 'craft native smoke '));
try {
  const source = resolve('dist-bin', filename);
  const data = await readFile(source);
  assert(data.length > 0, 'Native executable is empty');
  const published = source + (process.platform === 'win32' ? '' : '.gz');
  const publishedData = await readFile(published);
  if (process.platform !== 'win32')
    assert.deepEqual(gunzipSync(publishedData), data);
  const digest = createHash('sha256').update(publishedData).digest('hex');
  assert.equal(
    await readFile(`${published}.sha256`, 'utf8'),
    `${digest}  ${published.split(/[\\/]/).pop()}\n`,
  );
  const binary = join(
    root,
    process.platform === 'win32' ? 'craft.exe' : 'craft',
  );
  await copyFile(source, binary);
  await chmod(binary, 0o755);
  const config =
    "preReleaseCommand: ''\ngithub:\n  owner: fixture\n  repo: fixture\nchangelog:\n  policy: none\ntargets:\n  - name: github\n";
  await writeFile(join(root, '.craft.yml'), config);
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  const env = {
    ...process.env,
    CRAFT_WORKSPACE: '',
    CRAFT_CONFIG: '',
    CRAFT_LOG_LEVEL: 'Warn',
    NODE_OPTIONS: '',
  };
  const run = async (command, args, nodeFree = false) =>
    (
      await execute(command, args, {
        cwd: root,
        env: { ...env, ...(nodeFree && { PATH: root, Path: root }) },
        timeout: 30000,
      })
    ).stdout;
  assert.match(await run(binary, ['--help'], true), /prepare/);
  assert.match(
    await run(binary, ['--version'], true),
    new RegExp(`^${pkg.version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
  );
  assert.match(
    await run(binary, ['targets', '--dry-run', '--no-input'], true),
    /github/,
  );
  assert.equal(await readFile(join(root, '.craft.yml'), 'utf8'), config);

  // Exercise release preparation against a local Git remote only.
  const git = async (...args) =>
    (await execute('git', args, { cwd: root, env })).stdout;
  await git('init', '-b', 'main');
  await git('config', 'user.name', 'Craft Fixture');
  await git('config', 'user.email', 'fixture@example.invalid');
  await git('config', 'commit.gpgsign', 'false');
  await git('config', 'tag.gpgsign', 'false');
  await git('add', '.craft.yml');
  await git('commit', '-m', 'Fixture');
  await git('tag', '1.0.0');
  const remote = join(root, 'remote.git');
  await git('init', '--bare', remote);
  await git('--git-dir', remote, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  await git('remote', 'add', 'origin', remote);
  await git('push', 'origin', 'main', '--tags');
  const head = await git('rev-parse', 'HEAD');
  const branch = await git('symbolic-ref', 'HEAD');
  const remoteRefs = await git('ls-remote', 'origin');
  const status = await git('status', '--porcelain');
  await run(binary, [
    'prepare',
    '1.0.1',
    '--dry-run',
    '--no-input',
    '--no-git-checks',
    '--no-push',
  ]);
  assert.equal(
    await git('rev-parse', 'HEAD'),
    head,
    'Dry-run changed the checkout commit',
  );
  assert.equal(
    await git('symbolic-ref', 'HEAD'),
    branch,
    'Dry-run changed the checkout branch',
  );
  assert.equal(
    await git('ls-remote', 'origin'),
    remoteRefs,
    'Dry-run changed remote refs',
  );
  assert.equal(
    await git('status', '--porcelain'),
    status,
    'Dry-run changed checkout files',
  );
  assert.equal(await readFile(join(root, '.craft.yml'), 'utf8'), config);

  // The tarball must remain a portable JS package, without embedded Node binaries.
  const tarball = process.argv[2];
  assert(tarball, 'Pass the npm tarball path');
  const unpacked = join(root, 'npm');
  await mkdir(unpacked);
  await x({ file: resolve(tarball), cwd: unpacked });
  const manifest = JSON.parse(
    await readFile(join(unpacked, 'package/package.json'), 'utf8'),
  );
  for (const name of ['craft', 'sentry-craft']) {
    const script = join(unpacked, 'package', manifest.bin[name]);
    assert.match(await readFile(script, 'utf8'), /^#!\/usr\/bin\/env node/);
    assert.match(await run(process.execPath, [script, '--help']), /prepare/);
    assert.match(
      await run(process.execPath, [script, '--version']),
      /^\d+\.\d+\.\d+/,
    );
  }
  console.log(
    `Native (without Node on PATH) and npm smoke tests passed for ${platform}`,
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
