import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { safeFs } from '../utils/dryRun';
import { execFileSync } from 'node:child_process';
import { afterEach, expect, test, vi } from 'vitest';
import {
  resolveNativeRelease,
  updateNativeBinary,
} from '../utils/nativeUpdate';
const state = vi.hoisted(() => ({ dry: false }));
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
    ],
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

test('optional skill refresh failure does not undo or fail a verified binary update', async () => {
  network();
  const { executable, runtime } = await fixture();
  vi.mocked(execFileSync).mockImplementation((_file, args) => {
    if (args?.[0] === 'setup') throw new Error('skill refresh denied');
    return Buffer.from('9.1.0\n');
  });
  await expect(updateNativeBinary({}, runtime)).resolves.toBeUndefined();
  expect(await readFile(executable, 'utf8')).toBe('new');
});
