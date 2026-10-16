import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { afterEach, expect, test, vi } from 'vitest';

const moduleUrl = pathToFileURL(
  join(__dirname, '../../.github/scripts/install-craft.mjs'),
).href;
const directories: string[] = [];
afterEach(async () => {
  for (const dir of directories.splice(0))
    await rm(dir, { recursive: true, force: true });
});
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'craft action '));
  directories.push(dir);
  return dir;
}
const bytes = Buffer.from('native Craft fixture');
function network(asset: string | undefined) {
  return vi.fn(async (url: string) => {
    if (url.startsWith('https://api.github.com/'))
      return Response.json({
        tag_name: '2.35.0',
        draft: false,
        assets: [asset, 'craft'].filter(Boolean).map(name => ({
          name,
          state: 'uploaded',
          browser_download_url: `https://github.com/getsentry/craft/releases/download/2.35.0/${name}`,
        })),
      });
    return new Response(url.endsWith('.gz') ? gzipSync(bytes) : bytes);
  });
}
test.each([
  ['linux', 'x64', 'craft-linux-x64.gz'],
  ['linux', 'arm64', 'craft-linux-arm64.gz'],
  ['darwin', 'x64', 'craft-darwin-x64.gz'],
  ['darwin', 'arm64', 'craft-darwin-arm64.gz'],
  ['win32', 'x64', 'craft-win-x64.exe'],
])(
  'installs the matching %s/%s native release instead of JavaScript',
  async (platform, arch, asset) => {
    const { installCraft } = await import(moduleUrl);
    const dir = await fixture();
    const request = network(asset);
    const verify = vi.fn();
    const result = await installCraft({
      version: '2.35.0',
      directory: dir,
      platform,
      arch,
      request,
      verify,
    });
    expect(await readFile(result.path)).toEqual(bytes);
    expect(result.native).toBe(true);
    expect(verify).toHaveBeenCalledWith(expect.any(String), '2.35.0', platform);
    expect(request.mock.calls[1][0]).toContain(asset);
  },
);
test('old releases without a native asset keep the JavaScript compatibility path', async () => {
  const { installCraft } = await import(moduleUrl);
  const dir = await fixture();
  const result = await installCraft({
    version: '2.35.0',
    directory: dir,
    platform: 'linux',
    arch: 'x64',
    request: network(undefined),
    verify: vi.fn(),
  });
  expect(result.native).toBe(false);
  expect(await readFile(result.path)).toEqual(bytes);
});
test('an invalid native executable fails instead of silently using JavaScript', async () => {
  const { installCraft } = await import(moduleUrl);
  const dir = await fixture();
  const request = network('craft-linux-x64.gz');
  await expect(
    installCraft({
      version: '2.35.0',
      directory: dir,
      platform: 'linux',
      arch: 'x64',
      request,
      verify: () => {
        throw new Error('wrong executable version');
      },
    }),
  ).rejects.toThrow('wrong executable version');
  expect(request).toHaveBeenCalledTimes(2);
});
test('same-run native artifacts take precedence without a network download', async () => {
  const { installCraft } = await import(moduleUrl);
  const dir = await fixture();
  const artifacts = join(dir, 'artifacts');
  await mkdir(artifacts);
  await writeFile(join(artifacts, 'craft-linux-arm64.gz'), gzipSync(bytes));
  const request = vi.fn();
  const verify = vi.fn();
  const result = await installCraft({
    version: 'latest',
    expectedVersion: '2.36.0-dev.0',
    directory: join(dir, 'bin'),
    artifactDirectory: artifacts,
    platform: 'linux',
    arch: 'arm64',
    request,
    verify,
  });
  expect(result.native).toBe(true);
  expect(await readFile(result.path)).toEqual(bytes);
  expect(request).not.toHaveBeenCalled();
  expect(verify).toHaveBeenCalledWith(
    expect.any(String),
    '2.36.0-dev.0',
    'linux',
  );
});
test('a release cannot redirect the installer to an unrelated executable URL', async () => {
  const { installCraft } = await import(moduleUrl);
  const dir = await fixture();
  const request = vi.fn(async () =>
    Response.json({
      tag_name: '2.35.0',
      draft: false,
      assets: [
        {
          name: 'craft-linux-x64.gz',
          state: 'uploaded',
          browser_download_url: 'https://example.com/untrusted',
        },
      ],
    }),
  );
  await expect(
    installCraft({
      version: '2.35.0',
      directory: dir,
      platform: 'linux',
      arch: 'x64',
      request,
      verify: vi.fn(),
    }),
  ).rejects.toThrow(/asset URL/);
  expect(request).toHaveBeenCalledTimes(1);
});

test('an unavailable pinned release never falls back to latest', async () => {
  const { installCraft } = await import(moduleUrl);
  const request = vi.fn(
    async (_url: string) => new Response('not found', { status: 404 }),
  );
  await expect(
    installCraft({
      version: '2.33.0',
      directory: await fixture(),
      request,
      verify: vi.fn(),
    }),
  ).rejects.toThrow('HTTP 404');
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0][0]).toContain('/tags/2.33.0');
});
test('an exact GHCR nightly retains its verified JavaScript path without release requests', async () => {
  const { installCraft } = await import(moduleUrl);
  const sha = 'a'.repeat(40);
  const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  const request = vi.fn(async (url: string) => {
    if (url.includes('/token?'))
      return Response.json({ token: 'registry-fixture-token' });
    if (url.includes('/manifests/'))
      return Response.json({
        schemaVersion: 2,
        mediaType: 'application/vnd.oci.image.manifest.v1+json',
        artifactType: 'application/vnd.getsentry.craft.binary.v1',
        annotations: {
          'org.opencontainers.image.source':
            'https://github.com/getsentry/craft',
          'org.opencontainers.image.revision': sha,
        },
        layers: [
          {
            digest,
            size: bytes.length,
            mediaType: 'application/octet-stream',
            annotations: { 'org.opencontainers.image.title': 'craft' },
          },
        ],
      });
    if (url.includes('/blobs/')) return new Response(bytes);
    throw new Error(`Unexpected request: ${url}`);
  });
  const verify = vi.fn();
  const result = await installCraft({
    version: `nightly-${sha}`,
    directory: await fixture(),
    request,
    verify,
  });
  expect(result.native).toBe(false);
  expect(await readFile(result.path)).toEqual(bytes);
  expect(request.mock.calls.some(([url]) => url.includes('/releases/'))).toBe(
    false,
  );
  expect(verify).not.toHaveBeenCalled();
});
