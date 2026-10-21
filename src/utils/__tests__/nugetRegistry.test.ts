import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { vi } from 'vitest';

import {
  clearNugetRegistryCache,
  diffNupkgContents,
  getRemotePackageState,
  isSymbolPackagePublished,
  normalizeNugetVersion,
  readNupkgIdentity,
} from '../nugetRegistry';

const NUGET_ORG = 'https://api.nuget.org/v3/index.json';
const FLAT_CONTAINER = 'https://api.nuget.org/v3-flatcontainer/';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Builds a minimal (stored, uncompressed) ZIP archive */
function buildZip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(name);
    const data = Buffer.from(content);
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + data.length;
  }
  const centralDir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDir, end]);
}

function nuspec(id: string, version: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://schemas.microsoft.com/packaging/2013/05/nuspec.xsd">
  <metadata>
    <id>${id}</id>
    <version>${version}</version>
  </metadata>
</package>`;
}

const PACKAGE_FILES = {
  'Sentry.Serilog.nuspec': nuspec('Sentry.Serilog', '6.12.1'),
  'lib/net8.0/Sentry.Serilog.dll': 'assembly bytes',
  '[Content_Types].xml': '<Types/>',
};

let dir: string;

function writePackage(name: string, files: Record<string, string>): string {
  const path = join(dir, name);
  writeFileSync(path, buildZip(files));
  return path;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'craft-nuget-registry-'));
  clearNugetRegistryCache();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

describe('normalizeNugetVersion', () => {
  test.each([
    ['1.2.3', '1.2.3'],
    ['1.0', '1.0.0'],
    ['1', '1.0.0'],
    ['1.2.3.0', '1.2.3'],
    ['1.2.3.4', '1.2.3.4'],
    ['01.002.3', '1.2.3'],
    ['1.0.0-Beta.1', '1.0.0-beta.1'],
    ['1.0.0+git.abc', '1.0.0'],
    ['1.0.0-RC.2+build.5', '1.0.0-rc.2'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeNugetVersion(input)).toBe(expected);
  });
});

describe('readNupkgIdentity', () => {
  test('reads id and version from the nuspec', async () => {
    const path = writePackage('Sentry.Serilog.6.12.1.nupkg', PACKAGE_FILES);
    expect(await readNupkgIdentity(path)).toEqual({
      id: 'Sentry.Serilog',
      version: '6.12.1',
    });
  });

  test('throws when there is no nuspec', async () => {
    const path = writePackage('broken.nupkg', { 'lib/a.dll': 'x' });
    await expect(readNupkgIdentity(path)).rejects.toThrow(/No \.nuspec/);
  });
});

describe('diffNupkgContents', () => {
  test('ignores the repository signature', async () => {
    const local = writePackage('local.nupkg', PACKAGE_FILES);
    const remote = writePackage('remote.nupkg', {
      ...PACKAGE_FILES,
      '.signature.p7s': 'signed by nuget.org',
    });
    expect(await diffNupkgContents(local, remote)).toEqual([]);
  });

  test('reports changed, added and removed entries', async () => {
    const local = writePackage('local.nupkg', {
      ...PACKAGE_FILES,
      'lib/net8.0/Sentry.Serilog.dll': 'new assembly',
      'lib/net9.0/Sentry.Serilog.dll': 'only local',
    });
    const remote = writePackage('remote.nupkg', {
      ...PACKAGE_FILES,
      'lib/net6.0/Sentry.Serilog.dll': 'only remote',
    });
    expect(await diffNupkgContents(local, remote)).toEqual([
      'lib/net6.0/Sentry.Serilog.dll',
      'lib/net8.0/Sentry.Serilog.dll',
      'lib/net9.0/Sentry.Serilog.dll',
    ]);
  });
});

describe('getRemotePackageState', () => {
  const PACKAGE_URL = `${FLAT_CONTAINER}sentry.serilog/6.12.1/sentry.serilog.6.12.1.nupkg`;

  function stubFetch(packageResponse: () => Response) {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === NUGET_ORG) {
        return Response.json({
          resources: [
            {
              '@id': 'https://example.invalid/',
              '@type': 'SearchQueryService',
            },
            { '@id': FLAT_CONTAINER, '@type': 'PackageBaseAddress/3.0.0' },
          ],
        });
      }
      if (url === PACKAGE_URL) {
        return packageResponse();
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  test('returns missing when the version is not published', async () => {
    const local = writePackage('Sentry.Serilog.6.12.1.nupkg', PACKAGE_FILES);
    const fetchMock = stubFetch(() => new Response(null, { status: 404 }));

    expect(await getRemotePackageState(NUGET_ORG, local)).toEqual({
      status: 'missing',
    });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      NUGET_ORG,
      PACKAGE_URL,
    ]);
  });

  test('returns identical when only the signature differs', async () => {
    const local = writePackage('Sentry.Serilog.6.12.1.nupkg', PACKAGE_FILES);
    const remote = buildZip({ ...PACKAGE_FILES, '.signature.p7s': 'sig' });
    stubFetch(() => new Response(remote));

    expect(await getRemotePackageState(NUGET_ORG, local)).toEqual({
      status: 'identical',
      identity: { id: 'Sentry.Serilog', version: '6.12.1' },
    });
    // The local package is left untouched
    expect(readFileSync(local)).toEqual(buildZip(PACKAGE_FILES));
  });

  test('returns different when the contents differ', async () => {
    const local = writePackage('Sentry.Serilog.6.12.1.nupkg', PACKAGE_FILES);
    const remote = buildZip({
      ...PACKAGE_FILES,
      'lib/net8.0/Sentry.Serilog.dll': 'other assembly',
    });
    stubFetch(() => new Response(remote));

    expect(await getRemotePackageState(NUGET_ORG, local)).toEqual({
      status: 'different',
      differences: ['lib/net8.0/Sentry.Serilog.dll'],
    });
  });

  test('returns unknown on unexpected responses', async () => {
    const local = writePackage('Sentry.Serilog.6.12.1.nupkg', PACKAGE_FILES);
    stubFetch(() => new Response(null, { status: 503 }));

    expect(await getRemotePackageState(NUGET_ORG, local)).toMatchObject({
      status: 'unknown',
      reason: expect.stringContaining('HTTP 503'),
    });
  });

  test('returns unknown when the service index cannot be read', async () => {
    const local = writePackage('Sentry.Serilog.6.12.1.nupkg', PACKAGE_FILES);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 401 })),
    );

    expect(
      await getRemotePackageState('https://private.example/index.json', local),
    ).toMatchObject({
      status: 'unknown',
      reason: expect.stringContaining('HTTP 401'),
    });
  });
});

describe('isSymbolPackagePublished', () => {
  const identity = { id: 'Sentry.Serilog', version: '6.12.1' };
  const SYMBOL_URL =
    'https://globalcdn.nuget.org/symbol-packages/sentry.serilog.6.12.1.snupkg';

  test('returns true when nuget.org has the symbol package', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await isSymbolPackagePublished(NUGET_ORG, identity)).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      SYMBOL_URL,
      expect.objectContaining({ method: 'HEAD' }),
    );
  });

  test('returns false when nuget.org does not have it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 404 })),
    );
    expect(await isSymbolPackagePublished(NUGET_ORG, identity)).toBe(false);
  });

  test('returns undefined on unexpected responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 500 })),
    );
    expect(await isSymbolPackagePublished(NUGET_ORG, identity)).toBe(undefined);
  });

  test('returns undefined for feeds other than nuget.org', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(
      await isSymbolPackagePublished(
        'https://private.example/index.json',
        identity,
      ),
    ).toBe(undefined);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
