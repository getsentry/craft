import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gunzipSync, gzipSync, zstdCompressSync } from 'node:zlib';
import { promisify } from 'node:util';
import { test } from 'vitest';

test('running native updater applies binpatch and falls back for corrupt patches', async () => {
  const execute = promisify(execFile);
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  const name = `craft-${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}${process.platform === 'win32' ? '.exe' : ''}`;
  const filename = `${name}${process.platform === 'win32' ? '' : '.gz'}`;
  const archive = await readFile(resolve('dist-bin', filename));
  const base = process.platform === 'win32' ? archive : gunzipSync(archive);
  // Simulate adjacent stable releases by changing only the embedded version.
  // Equal-length replacements preserve the SEA layout; macOS fixtures are signed again.
  const oldVersion = `1.0.${'1'.repeat(pkg.version.length - 4)}`;
  const version = `2.0.${'2'.repeat(pkg.version.length - 4)}`;
  const root = await mkdtemp(join(tmpdir(), 'craft delta '));
  let server: ReturnType<typeof createServer> | undefined;
  try {
    const binName = process.platform === 'win32' ? 'craft.exe' : 'craft';
    const paths = [join(root, 'old', binName), join(root, 'new', binName)];
    for (const [index, releaseVersion] of [oldVersion, version].entries()) {
      const bytes = Buffer.from(base);
      const needle = Buffer.from(pkg.version);
      let offset = bytes.indexOf(needle);
      assert(offset >= 0, 'Embedded package version must be present');
      while (offset >= 0) {
        bytes.write(releaseVersion, offset);
        offset = bytes.indexOf(needle, offset + needle.length);
      }
      await mkdir(join(root, index === 0 ? 'old' : 'new'));
      await writeFile(paths[index], bytes, { mode: 0o700 });
      if (process.platform === 'darwin')
        await execute('codesign', ['--force', '--sign', '-', paths[index]]);
    }
    const old = await readFile(paths[0]);
    const next = await readFile(paths[1]);
    assert.equal(old.length, next.length);
    const control = Buffer.alloc(24);
    control.writeBigUInt64LE(BigInt(next.length));
    const diff = Buffer.alloc(next.length);
    for (let i = 0; i < diff.length; i++) diff[i] = (next[i] - old[i]) & 255;
    const blocks = [
      zstdCompressSync(control),
      zstdCompressSync(diff),
      zstdCompressSync(Buffer.alloc(0)),
    ];
    const header = Buffer.alloc(32);
    header.write('TRDIFF10');
    header.writeBigUInt64LE(BigInt(blocks[0].length), 8);
    header.writeBigUInt64LE(BigInt(blocks[1].length), 16);
    header.writeBigUInt64LE(BigInt(next.length), 24);
    const patch = Buffer.concat([header, ...blocks]);
    const compressed = gzipSync(next);
    const full = process.platform === 'win32' ? next : compressed;
    const sha = (bytes: Buffer) =>
      createHash('sha256').update(bytes).digest('hex');
    const prefix = `https://github.com/getsentry/craft/releases/download/${version}/`;
    const metadata = {
      tag_name: version,
      draft: false,
      prerelease: false,
      assets: [
        {
          name,
          size: next.length,
          digest: `sha256:${sha(next)}`,
          browser_download_url: `${prefix}${name}`,
        },
        {
          name: `${name}.gz`,
          size: compressed.length,
          browser_download_url: `${prefix}${name}.gz`,
        },
        {
          name: `${filename}.sha256`,
          browser_download_url: `${prefix}${filename}.sha256`,
        },
        {
          name: `${name}.patch`,
          size: patch.length,
          browser_download_url: `${prefix}${name}.patch`,
        },
      ],
    };
    assert(
      patch.length < compressed.length * 0.6,
      'Fixture delta must fit the download budget',
    );
    let corrupt = false;
    const requests: string[] = [];
    server = createServer((request, response) => {
      const url = request.url!;
      requests.push(url);
      if (url.includes('/releases?'))
        response.end(
          JSON.stringify([
            metadata,
            {
              tag_name: oldVersion,
              draft: false,
              prerelease: false,
              assets: [],
            },
          ]),
        );
      else if (url.includes('/releases/tags/'))
        response.end(JSON.stringify(metadata));
      else if (url.endsWith('.patch'))
        response.end(corrupt ? Buffer.from('bad patch') : patch);
      else if (url.endsWith('.sha256'))
        response.end(`${sha(full)}  ${filename}\n`);
      else if (url.endsWith(`/${filename}`)) response.end(full);
      else {
        response.statusCode = 404;
        response.end();
      }
    });
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert(address && typeof address !== 'string');
    const preload = join(root, 'fixture.cjs');
    await writeFile(
      preload,
      `const original = globalThis.fetch; globalThis.fetch = (url, init) => { const target = new URL(url); if (!['https://api.github.com','https://github.com'].includes(target.origin)) throw new Error('Unexpected URL'); return original('http://127.0.0.1:${address.port}' + target.pathname + target.search, init); };`,
    );
    const env = {
      ...process.env,
      HOME: root,
      USERPROFILE: root,
      XDG_CONFIG_HOME: join(root, 'config'),
      XDG_DATA_HOME: join(root, 'share'),
      CRAFT_WORKSPACE: '',
      CRAFT_CONFIG: '',
      CRAFT_DRY_RUN: '',
      DRY_RUN: '',
      NODE_OPTIONS: `--require "${preload.replace(/\\/g, '/')}"`,
    };
    for (const fallback of [false, true]) {
      corrupt = fallback;
      requests.length = 0;
      await writeFile(`${paths[0]}.reset`, old);
      await rename(`${paths[0]}.reset`, paths[0]);
      await chmod(paths[0], 0o700);
      await execute(paths[0], ['update', version], {
        cwd: root,
        env,
        timeout: 180000,
      });
      assert(
        (await readFile(paths[0])).equals(next),
        'Updated image must exactly match the target digest',
      );
      assert(requests.some(url => url.endsWith('.patch')));
      assert.equal(
        requests.some(url => url.endsWith(`/${filename}`)),
        fallback,
        'Valid delta must avoid the full download',
      );
      assert.match(
        (await execute(paths[0], ['--version'], { cwd: root, env })).stdout,
        new RegExp(version.replace(/\./g, '\\.')),
      );
    }
  } finally {
    if (server)
      await new Promise<void>((resolve, reject) =>
        server!.close(error => (error ? reject(error) : resolve())),
      );
    await rm(root, { recursive: true, force: true });
  }
});
