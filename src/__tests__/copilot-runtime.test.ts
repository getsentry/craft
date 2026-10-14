import { createHash } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
  readFile,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { create } from 'tar';
import { afterEach, expect, test, vi } from 'vitest';

const script = pathToFileURL(
  join(__dirname, '../../.github/scripts/copilot/unpack-runtime.mjs'),
).href;
const directories: string[] = [];
async function temporary() {
  const directory = await mkdtemp(join(tmpdir(), 'craft-runtime-test-'));
  directories.push(directory);
  return directory;
}
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map(path => rm(path, { recursive: true, force: true })),
  );
});
function fixture(content = Buffer.from('runtime archive')) {
  const metadata = {
    tag_name: '2.35.0',
    assets: [
      {
        name: 'copilot-runtime.tar.gz',
        size: content.length,
        digest: `sha256:${createHash('sha256').update(content).digest('hex')}`,
        browser_download_url:
          'https://github.com/getsentry/craft/releases/download/2.35.0/copilot-runtime.tar.gz',
      },
    ],
  };
  const request = vi.fn(async (url: string) =>
    new URL(url).hostname === 'api.github.com'
      ? Response.json(metadata)
      : new Response(content),
  );
  return { content, metadata, request };
}

test('release runtime is downloaded only from the canonical asset and verified', async () => {
  const { downloadReleaseRuntime } = await import(script);
  const { content, request } = fixture();
  const output = join(await temporary(), 'runtime.tar.gz');
  await downloadReleaseRuntime('2.35.0', output, request);
  expect(await readFile(output)).toEqual(content);
});

test.each(['digest', 'size', 'url'])(
  'rejects invalid asset %s before downloading',
  async field => {
    const { downloadReleaseRuntime } = await import(script);
    const { metadata, request } = fixture();
    if (field === 'digest') metadata.assets[0].digest = 'invalid';
    if (field === 'size') metadata.assets[0].size = 129 * 1024 * 1024;
    if (field === 'url')
      metadata.assets[0].browser_download_url =
        'https://untrusted.example/runtime';
    await expect(
      downloadReleaseRuntime(
        '2.35.0',
        join(await temporary(), 'runtime'),
        request,
      ),
    ).rejects.toThrow('Invalid runtime release asset');
    expect(request).toHaveBeenCalledTimes(1);
  },
);

test('rejects modified bytes before writing the runtime', async () => {
  const { downloadReleaseRuntime } = await import(script);
  const { request, metadata } = fixture();
  metadata.assets[0].digest = 'sha256:' + 'f'.repeat(64);
  await expect(
    downloadReleaseRuntime(
      '2.35.0',
      join(await temporary(), 'runtime'),
      request,
    ),
  ).rejects.toThrow('Runtime digest or size mismatch');
});

test('unpacks a portable SDK archive without executing package scripts', async () => {
  const { unpackRuntime } = await import(script);
  const source = await temporary();
  const module = join(source, 'node_modules/@github/copilot-sdk');
  await mkdir(module, { recursive: true });
  await writeFile(
    join(module, 'package.json'),
    JSON.stringify({ version: '1.0.21', scripts: { postinstall: 'exit 1' } }),
  );
  await writeFile(join(source, 'package.json'), '{}');
  await mkdir(join(source, 'licenses/@github__copilot-sdk'), {
    recursive: true,
  });
  await writeFile(join(source, 'licenses/@github__copilot-sdk/LICENSE'), 'MIT');
  const archive = join(await temporary(), 'runtime.tar.gz');
  await create({ file: archive, gzip: true, cwd: source }, [
    'package.json',
    'node_modules',
    'licenses',
  ]);
  const output = await temporary();
  await unpackRuntime(archive, output);
  expect(
    JSON.parse(
      await readFile(
        join(output, 'node_modules/@github/copilot-sdk/package.json'),
        'utf8',
      ),
    ).version,
  ).toBe('1.0.21');
  expect(
    await readFile(
      join(output, 'licenses/@github__copilot-sdk/LICENSE'),
      'utf8',
    ),
  ).toBe('MIT');
});

test('rejects unrelated archive paths before extraction', async () => {
  const { unpackRuntime } = await import(script);
  const source = await temporary();
  await writeFile(join(source, 'unexpected-file'), 'bad');
  const archive = join(await temporary(), 'runtime.tar.gz');
  await create({ file: archive, gzip: true, cwd: source }, ['unexpected-file']);
  await expect(unpackRuntime(archive, await temporary())).rejects.toThrow(
    'Unsafe runtime archive path',
  );
});

test('rejects release metadata for a different version', async () => {
  const { downloadReleaseRuntime } = await import(script);
  const { request } = fixture();
  await expect(
    downloadReleaseRuntime(
      '2.34.0',
      join(await temporary(), 'runtime'),
      request,
    ),
  ).rejects.toThrow('Runtime release version mismatch');
  expect(request).toHaveBeenCalledTimes(1);
});

test('rejects archive symlinks before extraction', async () => {
  const { unpackRuntime } = await import(script);
  const source = await temporary();
  await mkdir(join(source, 'node_modules'));
  await symlink('../../outside', join(source, 'node_modules/link'));
  const archive = join(await temporary(), 'runtime.tar.gz');
  await create({ file: archive, gzip: true, cwd: source }, ['node_modules']);
  await expect(unpackRuntime(archive, await temporary())).rejects.toThrow(
    'Runtime archive links are forbidden',
  );
});

test.each(['truncated', 'oversized', 'corrupt'])(
  'rejects %s runtime bodies without writing a partial artifact',
  async kind => {
    const { downloadReleaseRuntime } = await import(script);
    const { metadata, request, content } = fixture();
    const body =
      kind === 'truncated'
        ? content.subarray(1)
        : kind === 'oversized'
          ? Buffer.concat([content, Buffer.from('extra')])
          : Buffer.alloc(content.length);
    request
      .mockResolvedValueOnce(Response.json(metadata))
      .mockResolvedValueOnce(new Response(body));
    const output = join(await temporary(), 'runtime');
    await expect(
      downloadReleaseRuntime('2.35.0', output, request),
    ).rejects.toThrow(/declared size|digest or size mismatch/);
    await expect(readFile(output)).rejects.toMatchObject({ code: 'ENOENT' });
  },
);
