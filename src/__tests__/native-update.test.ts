import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gzipSync, zstdCompressSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { safeFs } from '../utils/dryRun';
import { execFileSync } from 'node:child_process';
import { afterEach, expect, test, vi } from 'vitest';
import * as binpatch from 'binpatch';
import {
  resolveNativeRelease,
  updateNativeBinary,
} from '../utils/nativeUpdate';
const state = vi.hoisted(() => ({ dry: false }));
vi.mock('binpatch', { spy: true });
vi.mock('../utils/helpers', () => ({ isDryRun: () => state.dry }));
vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(() => Buffer.from('9.1.0\n')),
}));
const dirs: string[] = [];
afterEach(async () => {
  state.dry = false;
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.mocked(execFileSync).mockReturnValue(Buffer.from('9.1.0\n'));
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true });
});
function release(version = '9.1.0') {
  const name = 'craft-linux-x64.gz';
  const url = `https://github.com/getsentry/craft/releases/download/${version}/${name}`;
  return {
    tag_name: version,
    draft: false,
    prerelease: version.includes('-'),
    assets: [
      { name, browser_download_url: url },
      { name: `${name}.sha256`, browser_download_url: `${url}.sha256` },
    ] as {
      name: string;
      browser_download_url: string;
      size?: number;
      digest?: string;
    }[],
  };
}
function network(
  options: { metadata?: unknown; checksum?: string; status?: number } = {},
) {
  const data = gzipSync(Buffer.from('new'));
  const checksum = `${createHash('sha256').update(data).digest('hex')}  craft-linux-x64.gz\n`;
  const fetch = vi.fn(async (url: string) => {
    if (options.status) return new Response('', { status: options.status });
    if (url.startsWith('https://api.github.com/'))
      return Response.json(options.metadata ?? release());
    if (url.endsWith('.sha256'))
      return new Response(options.checksum ?? checksum);
    return new Response(data);
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'craft update '));
  dirs.push(dir);
  const executable = join(dir, 'craft');
  await writeFile(executable, 'old');
  return {
    dir,
    executable,
    runtime: {
      executable,
      currentVersion: '9.0.0',
      native: true,
      platform: 'linux',
      arch: 'x64',
    },
  };
}
test('selects latest stable and validates exact assets without authentication', async () => {
  const fetch = network();
  const result = await resolveNativeRelease(undefined, 'linux', 'x64');
  expect(result.version).toBe('9.1.0');
  expect(fetch.mock.calls[0][0]).toBe(
    'https://api.github.com/repos/getsentry/craft/releases/latest',
  );
});
test('explicit prerelease selection uses the requested tag', async () => {
  const fetch = network({ metadata: release('9.2.0-beta.1') });
  expect(
    (await resolveNativeRelease('9.2.0-beta.1', 'linux', 'x64')).version,
  ).toBe('9.2.0-beta.1');
  expect(fetch.mock.calls[0][0]).toContain('/tags/9.2.0-beta.1');
});
test.each([
  ['prerelease latest', release('9.2.0-beta.1')],
  ['draft', { ...release(), draft: true }],
  ['missing asset', { ...release(), assets: [] }],
  [
    'foreign URL',
    {
      ...release(),
      assets: [
        {
          name: 'craft-linux-x64.gz',
          browser_download_url: 'https://example.com/craft-linux-x64.gz',
        },
      ],
    },
  ],
  ['malformed metadata', null],
])('rejects %s before downloading bytes', async (_name, metadata) => {
  const fetch = network({ metadata });
  if (metadata === null) fetch.mockResolvedValue(Response.json(null));
  await expect(
    resolveNativeRelease(undefined, 'linux', 'x64'),
  ).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(1);
});
test('rejects malformed versions and mismatched tags', async () => {
  const fetch = network();
  await expect(
    resolveNativeRelease('../../bad', 'linux', 'x64'),
  ).rejects.toThrow(/version/i);
  expect(fetch).not.toHaveBeenCalled();
  await expect(resolveNativeRelease('9.0.1', 'linux', 'x64')).rejects.toThrow(
    /tag|version/i,
  );
});
test('HTTP failures and body limits fail closed', async () => {
  network({ status: 404 });
  await expect(resolveNativeRelease(undefined, 'linux', 'x64')).rejects.toThrow(
    /404/,
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response('{}', { headers: { 'content-length': '1048577' } }),
    ),
  );
  await expect(resolveNativeRelease(undefined, 'linux', 'x64')).rejects.toThrow(
    /large|limit/i,
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('x'.repeat(1048577))),
  );
  await expect(resolveNativeRelease(undefined, 'linux', 'x64')).rejects.toThrow(
    /large|limit/i,
  );
});
test('installs verified bytes and cleans all staging files', async () => {
  network();
  const { dir, executable, runtime } = await fixture();
  await updateNativeBinary({}, runtime);
  expect(await readFile(executable, 'utf8')).toBe('new');
  expect(await readdir(dir)).toEqual(['craft']);
});
test.each(['check', 'dry'])(
  '%s resolves metadata without downloading or writing',
  async mode => {
    const fetch = network();
    const { dir, executable, runtime } = await fixture();
    state.dry = mode === 'dry';
    await updateNativeBinary({ check: mode === 'check' }, runtime);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await readFile(executable, 'utf8')).toBe('old');
    expect(await readdir(dir)).toEqual(['craft']);
  },
);
test.each([
  ['mismatch', `${'0'.repeat(64)}  craft-linux-x64.gz\n`],
  ['wrong name', `${'0'.repeat(64)}  evil.gz\n`],
  ['malformed', 'bad'],
])(
  'checksum %s preserves old bytes without executing candidate',
  async (_name, checksum) => {
    network({ checksum });
    const { executable, runtime } = await fixture();
    await expect(updateNativeBinary({}, runtime)).rejects.toThrow(/checksum/i);
    expect(await readFile(executable, 'utf8')).toBe('old');
    expect(execFileSync).not.toHaveBeenCalled();
  },
);
test('a candidate reporting the wrong version is never installed', async () => {
  network();
  const { executable, runtime } = await fixture();
  vi.mocked(execFileSync).mockReturnValue(Buffer.from('8.0.0\n'));
  await expect(updateNativeBinary({}, runtime)).rejects.toThrow(/version/i);
  expect(await readFile(executable, 'utf8')).toBe('old');
});
test('npm and Homebrew use their package managers without network calls', async () => {
  const fetch = network();
  const { runtime } = await fixture();
  await expect(
    updateNativeBinary({}, { ...runtime, native: false }),
  ).rejects.toThrow(/npm|pnpm/i);
  await expect(
    updateNativeBinary(
      {},
      { ...runtime, executable: '/opt/homebrew/Cellar/craft/9.0.0/bin/craft' },
    ),
  ).rejects.toThrow(/brew upgrade/i);
  expect(fetch).not.toHaveBeenCalled();
});
test('same version is a no-op, and explicit downgrade requires force', async () => {
  const fetch = network();
  const { runtime } = await fixture();
  await updateNativeBinary({}, { ...runtime, currentVersion: '9.1.0' });
  expect(fetch).toHaveBeenCalledTimes(1);
  await expect(
    updateNativeBinary(
      { version: '9.1.0' },
      { ...runtime, currentVersion: '9.2.0' },
    ),
  ).rejects.toThrow(/force/i);
});

test('force permits a verified same-version reinstall', async () => {
  network();
  const { executable, runtime } = await fixture();
  await updateNativeBinary(
    { force: true },
    { ...runtime, currentVersion: '9.1.0' },
  );
  expect(await readFile(executable, 'utf8')).toBe('new');
});
test('a failed final rename preserves the original and removes staging files', async () => {
  network();
  const { executable, runtime, dir } = await fixture();
  vi.spyOn(safeFs, 'rename').mockRejectedValue(new Error('rename denied'));
  await expect(updateNativeBinary({}, runtime)).rejects.toThrow(
    'rename denied',
  );
  expect(await readFile(executable, 'utf8')).toBe('old');
  expect(await readdir(dir)).toEqual(['craft']);
});
test('a concurrent replacement is rejected inside the placement lock', async () => {
  network();
  const { executable, runtime } = await fixture();
  vi.mocked(execFileSync).mockImplementation(() => {
    writeFileSync(executable, 'intervening installation');
    return Buffer.from('9.1.0\n');
  });
  await expect(updateNativeBinary({}, runtime)).rejects.toThrow(
    /changed during/,
  );
  expect(await readFile(executable, 'utf8')).toBe('intervening installation');
});
test('binary body limits and aborts preserve the executable', async () => {
  const fetch = network();
  const { executable, runtime } = await fixture();
  const original = fetch.getMockImplementation()!;
  fetch.mockImplementation(async url =>
    url.endsWith('.gz')
      ? new Response('', { headers: { 'content-length': '268435457' } })
      : original(url),
  );
  await expect(updateNativeBinary({}, runtime)).rejects.toThrow(/limit/);
  expect(await readFile(executable, 'utf8')).toBe('old');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, init) => {
      expect(init.signal).toBeInstanceOf(AbortSignal);
      throw new DOMException('timeout', 'TimeoutError');
    }),
  );
  await expect(updateNativeBinary({}, runtime)).rejects.toThrow('timeout');
  expect(await readFile(executable, 'utf8')).toBe('old');
});

test('accepts the candidate CI build SHA while matching the exact release version', async () => {
  network();
  const { executable, runtime } = await fixture();
  vi.mocked(execFileSync).mockReturnValue(
    Buffer.from(`9.1.0 (${'a'.repeat(40)})\n`),
  );
  await updateNativeBinary({}, runtime);
  expect(await readFile(executable, 'utf8')).toBe('new');
});

test('accepts canonical SemVer build metadata and rejects prefixed versions', async () => {
  const fetch = network({ metadata: release('9.1.0+build.1') });
  expect(
    (await resolveNativeRelease('9.1.0+build.1', 'linux', 'x64')).version,
  ).toBe('9.1.0+build.1');
  await expect(resolveNativeRelease('v9.1.0', 'linux', 'x64')).rejects.toThrow(
    /version/i,
  );
  expect(fetch).toHaveBeenCalledTimes(1);
});

// A real TRDIFF10 patch changes the three bytes read from the installed image.
function deltaNetwork(mode = 'valid') {
  const old = Buffer.from('old');
  const target = Buffer.from('new');
  const control = Buffer.alloc(24);
  control.writeBigUInt64LE(mode === 'control-overrun' ? 1048576n : 3n);
  const blocks = [
    zstdCompressSync(
      mode === 'control-bomb' ? Buffer.alloc(16 * 1024 * 1024 + 1) : control,
    ),
    zstdCompressSync(
      mode === 'control-overrun' || mode === 'diff-bomb'
        ? Buffer.alloc(1048576)
        : Buffer.from(target.map((byte, i) => (byte - old[i]) & 255)),
    ),
    zstdCompressSync(Buffer.alloc(mode === 'extra-bomb' ? 1048576 : 0)),
  ];
  const header = Buffer.alloc(32);
  header.write('TRDIFF10');
  header.writeBigUInt64LE(BigInt(blocks[0].length), 8);
  header.writeBigUInt64LE(BigInt(blocks[1].length), 16);
  header.writeBigUInt64LE(mode === 'oversized' ? 536870913n : 3n, 24);
  const patch = Buffer.concat([header, ...blocks]);
  const metadata = release(mode === 'prerelease' ? '9.1.0-beta.1' : '9.1.0');
  metadata.prerelease = false;
  const base = `https://github.com/getsentry/craft/releases/download/${metadata.tag_name}/`;
  Object.assign(metadata.assets[0], {
    size: mode === 'actual-over-budget' ? 100 : 4096,
  });
  metadata.assets.push(
    {
      name: 'craft-linux-x64',
      browser_download_url: `${base}craft-linux-x64`,
      size: 3,
      digest: `sha256:${createHash('sha256').update(target).digest('hex')}`,
    },
    {
      name: 'craft-linux-x64.patch',
      browser_download_url:
        mode === 'foreign'
          ? 'https://example.com/evil.patch'
          : `${base}craft-linux-x64.patch`,
      size:
        mode === 'over-budget'
          ? 4096
          : mode === 'actual-over-budget'
            ? 1
            : patch.length,
    },
  );
  const fetch = network({ metadata });
  const fallback = fetch.getMockImplementation()!;
  fetch.mockImplementation(async url => {
    if (url.endsWith('/releases?per_page=12'))
      return Response.json([metadata, { ...release('9.0.0'), assets: [] }]);
    if (url.endsWith('.patch'))
      return new Response(
        mode === 'corrupt' ? Buffer.from('bad patch') : patch,
      );
    if (mode === 'valid' && url.endsWith('.gz'))
      throw new Error('A valid delta must avoid the full binary download');
    return fallback(url);
  });
  return fetch;
}
test('applies a real binpatch delta without downloading the full binary', async () => {
  deltaNetwork();
  const { executable, runtime } = await fixture();
  await updateNativeBinary({}, runtime);
  expect(await readFile(executable, 'utf8')).toBe('new');
});
test.each([
  'corrupt',
  'foreign',
  'over-budget',
  'actual-over-budget',
  'oversized',
  'wrong-base',
])('falls back to verified full download for a %s patch', async mode => {
  const fetch = deltaNetwork(mode);
  const { executable, runtime } = await fixture();
  if (mode === 'wrong-base') await writeFile(executable, 'bad');
  await updateNativeBinary({}, runtime);
  expect(await readFile(executable, 'utf8')).toBe('new');
  expect(fetch.mock.calls.some(([url]) => url.endsWith('.gz'))).toBe(true);
  expect(fetch.mock.calls.some(([url]) => url.endsWith('.patch'))).toBe(
    !['foreign', 'over-budget'].includes(mode),
  );
  expect(
    fetch.mock.calls.some(([url]) => url.startsWith('https://example.com/')),
  ).toBe(false);
});

test('a failed patch and invalid full checksum preserve the installed binary', async () => {
  const fetch = deltaNetwork('corrupt');
  const original = fetch.getMockImplementation()!;
  fetch.mockImplementation(async url =>
    url.endsWith('.sha256')
      ? new Response(`${'0'.repeat(64)}  craft-linux-x64.gz\n`)
      : original(url),
  );
  const { executable, runtime, dir } = await fixture();
  await expect(updateNativeBinary({}, runtime)).rejects.toThrow(
    /Checksum mismatch/,
  );
  expect(await readFile(executable, 'utf8')).toBe('old');
  expect(await readdir(dir)).toEqual(['craft']);
});
test.each(['check', 'dry-run'])(
  '%s never discovers or applies available patches',
  async mode => {
    const fetch = deltaNetwork();
    const { executable, runtime } = await fixture();
    state.dry = mode === 'dry-run';
    await updateNativeBinary({ check: mode === 'check' }, runtime);
    expect(await readFile(executable, 'utf8')).toBe('old');
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);

test.each(['control-overrun', 'control-bomb', 'diff-bomb', 'extra-bomb'])(
  'rejects %s before invoking binpatch application',
  async mode => {
    deltaNetwork(mode);
    const apply = vi.mocked(binpatch.applyPatchChainInMemory);
    const applyMemory = vi.mocked(binpatch.applyPatchToMemory);
    const { executable, runtime } = await fixture();
    await updateNativeBinary({}, runtime);
    expect(await readFile(executable, 'utf8')).toBe('new');
    expect(apply).not.toHaveBeenCalled();
    expect(applyMemory).not.toHaveBeenCalled();
  },
);

test('explicit SemVer prereleases use full downloads even when mislabeled stable', async () => {
  const fetch = deltaNetwork('prerelease');
  const { runtime, executable } = await fixture();
  vi.mocked(execFileSync).mockReturnValue(Buffer.from('9.1.0-beta.1\n'));
  await updateNativeBinary({ version: '9.1.0-beta.1' }, runtime);
  expect(await readFile(executable, 'utf8')).toBe('new');
  expect(fetch.mock.calls.some(([url]) => url.includes('/releases?'))).toBe(
    false,
  );
});
