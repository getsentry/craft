// Run the shipped app's self-update using local HTTP fixtures, including Windows.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  mkdtemp,
  readFile,
  writeFile,
  chmod,
  rm,
  readdir,
  stat,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { gunzipSync } from 'node:zlib';
import { test } from 'vitest';

test('running native updates preserve the executable on failure', async () => {
  const execute = promisify(execFile);
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  const platform = `${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`;
  const filename = `craft-${platform}${process.platform === 'win32' ? '.exe' : '.gz'}`;
  const archive = await readFile(resolve('dist-bin', filename));
  const checksum = await readFile(resolve('dist-bin', `${filename}.sha256`));
  const root = await mkdtemp(join(tmpdir(), 'craft updater smoke '));
  let corrupt = false;
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.url || '');
    if (request.url === `/repos/getsentry/craft/releases/tags/${pkg.version}`) {
      const url = `https://github.com/getsentry/craft/releases/download/${pkg.version}/${filename}`;
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({
          tag_name: pkg.version,
          draft: false,
          prerelease: pkg.version.includes('-'),
          assets: [
            { name: filename, browser_download_url: url },
            {
              name: `${filename}.sha256`,
              browser_download_url: `${url}.sha256`,
            },
          ],
        }),
      );
    } else if (
      request.url ===
      `/getsentry/craft/releases/download/${pkg.version}/${filename}`
    )
      response.end(archive);
    else if (
      request.url ===
      `/getsentry/craft/releases/download/${pkg.version}/${filename}.sha256`
    )
      response.end(corrupt ? `${'0'.repeat(64)}  ${filename}\n` : checksum);
    else {
      response.statusCode = 404;
      response.end('unexpected fixture URL');
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const preload = join(root, 'fixture.cjs');
    await writeFile(
      preload,
      `
const fs = require('node:fs/promises');
const rawFs = require('node:fs');
const originalRename = fs.rename;
if (process.env.CRAFT_TEST_FAIL_RENAME === '1') fs.rename = async (from, to) => {
  if (String(from).includes('.craft-install-') && to === process.execPath) {
    if (process.platform === 'win32' && rawFs.existsSync(to)) throw new Error('Original Windows path was not moved before replacement');
    rawFs.writeFileSync(to + '.rollback-marker', 'replacement attempted');
    throw new Error('fixture replacement denied');
  }
  return originalRename(from, to);
};
const originalFetch = globalThis.fetch;
globalThis.fetch = (url, init) => {
  const requested = new URL(url);
  if (!['https://api.github.com', 'https://github.com'].includes(requested.origin)) throw new Error('Unexpected network request: ' + url);
  return originalFetch('http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}' + requested.pathname, init);
};
`,
    );
    const binary = join(
      root,
      process.platform === 'win32' ? 'craft.exe' : 'craft',
    );
    await writeFile(
      binary,
      process.platform === 'win32' ? archive : gunzipSync(archive),
    );
    await chmod(binary, 0o755);
    const env = {
      ...process.env,
      HOME: root,
      USERPROFILE: root,
      XDG_DATA_HOME: join(root, 'share'),
      XDG_CONFIG_HOME: join(root, 'config'),
      CRAFT_WORKSPACE: '',
      CRAFT_CONFIG: '',
      CRAFT_DRY_RUN: '',
      DRY_RUN: '',
      CRAFT_LOG_LEVEL: 'Info',
      NODE_OPTIONS: `--require "${preload.replace(/\\/g, '/')}"`,
    };
    const run = (...args: string[]) =>
      execute(binary, ['update', pkg.version, '--force', ...args], {
        cwd: root,
        env,
        timeout: 180000,
      });
    const before = await stat(binary, { bigint: true });
    await run();
    const after = await stat(binary, { bigint: true });
    assert.notEqual(
      after.ino,
      before.ino,
      'Update must replace the actual running executable',
    );
    assert.equal(
      (await execute(binary, ['--version'], { cwd: root, env })).stdout
        .trim()
        .replace(/ \([0-9a-f]{40}\)$/i, ''),
      pkg.version,
    );
    const installed = await readFile(binary);
    await assert.rejects(
      execute(binary, ['update', pkg.version, '--force'], {
        cwd: root,
        env: { ...env, CRAFT_TEST_FAIL_RENAME: '1' },
        timeout: 180000,
      }),
      /fixture replacement denied/,
    );
    assert.equal(
      await readFile(`${binary}.rollback-marker`, 'utf8'),
      'replacement attempted',
    );
    assert.deepEqual(await readFile(binary), installed);
    assert.equal(
      (await execute(binary, ['--version'], { cwd: root, env })).stdout
        .trim()
        .replace(/ \([0-9a-f]{40}\)$/i, ''),
      pkg.version,
    );
    assert(
      !(await readdir(root)).some(
        name =>
          name === '.craft-install.lock' || name.startsWith('.craft-install-'),
      ),
      'Rollback must clean staging and lock files',
    );
    corrupt = true;
    await assert.rejects(run(), /Checksum mismatch/);
    assert.deepEqual(await readFile(binary), installed);
    const files = await readdir(root);
    const requestsBefore = requests.length;
    await run('--dry-run');
    assert.deepEqual(await readdir(root), files);
    assert.equal(
      requests.length - requestsBefore,
      1,
      'Dry-run only fetches metadata',
    );
    assert.deepEqual(await readFile(binary), installed);
    // The portable JS distribution must reject self-update before network or writes.
    const requestsBeforeNpm = requests.length;
    await assert.rejects(
      execute(process.execPath, [resolve('packed/dist/craft'), 'update'], {
        cwd: root,
        env,
      }),
      /npm\/pnpm/,
    );
    assert.equal(requests.length, requestsBeforeNpm);
    console.log(
      `Running native replacement and rollback, checksum failure, dry-run and npm guard verified: ${platform}`,
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve())),
    );
    await rm(root, { recursive: true, force: true });
  }
}, 180000);
