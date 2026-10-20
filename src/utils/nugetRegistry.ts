import { createHash } from 'crypto';
import { createWriteStream } from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import type { ReadableStream as WebReadableStream } from 'stream/web';
import StreamZip from 'node-stream-zip';
import { XMLParser } from 'fast-xml-parser';

import { logger } from '../logger';
import { withTempDir } from './files';

/** nuget.org's service index, used to recognize the public gallery */
const NUGET_ORG_SERVICE_INDEX = 'https://api.nuget.org/v3/index.json';

/**
 * Where nuget.org serves published symbol packages. There is no service
 * index resource for this, so it only applies to nuget.org itself.
 */
const NUGET_ORG_SYMBOL_PACKAGES_URL =
  'https://globalcdn.nuget.org/symbol-packages';

/**
 * nuget.org (and other feeds) repository-sign packages after upload, which
 * adds or replaces this entry. It must be ignored when comparing a local
 * package with the published one.
 */
const SIGNATURE_ENTRY = '.signature.p7s';

/** Timeout for registry metadata requests (service index, HEAD checks) */
const METADATA_TIMEOUT_MS = 30 * 1000;

/** Timeout for downloading a published package for comparison */
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;

/** Identity of a NuGet package as recorded in its .nuspec */
export interface NugetPackageIdentity {
  id: string;
  version: string;
}

/** What the server already has for a package version */
export type RemotePackageState =
  /** The version is not published yet */
  | { status: 'missing' }
  /** The published package has the same contents as the local one */
  | { status: 'identical'; identity: NugetPackageIdentity }
  /** The published package differs from the local one */
  | { status: 'different'; differences: string[] }
  /** The state could not be determined (e.g. unsupported feed, network error) */
  | { status: 'unknown'; reason: string };

/**
 * Normalizes a NuGet version the way the server does for its URLs:
 * build metadata is dropped, numeric parts lose leading zeros, missing
 * minor/patch parts become zero, a zero fourth part is removed, and
 * everything is lowercased.
 *
 * @see https://learn.microsoft.com/en-us/nuget/concepts/package-versioning#normalized-version-numbers
 */
export function normalizeNugetVersion(version: string): string {
  const withoutMetadata = version.split('+')[0];
  const dash = withoutMetadata.indexOf('-');
  const release =
    dash === -1 ? withoutMetadata : withoutMetadata.slice(0, dash);
  const prerelease = dash === -1 ? '' : withoutMetadata.slice(dash);

  const parts = release
    .split('.')
    .map(part => (/^\d+$/.test(part) ? String(parseInt(part, 10)) : part));
  while (parts.length < 3) {
    parts.push('0');
  }
  if (parts.length === 4 && parts[3] === '0') {
    parts.pop();
  }
  return `${parts.join('.')}${prerelease}`.toLowerCase();
}

/**
 * Reads the package ID and version from the .nuspec inside a .nupkg.
 */
export async function readNupkgIdentity(
  nupkgPath: string,
): Promise<NugetPackageIdentity> {
  const zip = new StreamZip.async({ file: nupkgPath });
  try {
    const entries = Object.values(await zip.entries());
    const nuspec = entries.find(
      entry => !entry.name.includes('/') && entry.name.endsWith('.nuspec'),
    );
    if (!nuspec) {
      throw new Error(`No .nuspec found in ${nupkgPath}`);
    }
    const parsed = new XMLParser({ parseTagValue: false }).parse(
      (await zip.entryData(nuspec)).toString('utf-8'),
    );
    const metadata = parsed?.package?.metadata;
    if (!metadata?.id || !metadata?.version) {
      throw new Error(`Missing id or version in ${nuspec.name}`);
    }
    return { id: String(metadata.id), version: String(metadata.version) };
  } finally {
    await zip.close();
  }
}

/**
 * Returns a map of entry name to the SHA-256 of its uncompressed contents,
 * excluding the repository signature.
 */
async function readNupkgEntries(
  nupkgPath: string,
): Promise<Map<string, string>> {
  const zip = new StreamZip.async({ file: nupkgPath });
  try {
    const result = new Map<string, string>();
    for (const entry of Object.values(await zip.entries())) {
      if (entry.isDirectory || entry.name === SIGNATURE_ENTRY) {
        continue;
      }
      const hash = createHash('sha256');
      await pipeline(await zip.stream(entry), hash);
      result.set(entry.name, hash.digest('hex'));
    }
    return result;
  } finally {
    await zip.close();
  }
}

/**
 * Compares the contents of two packages, ignoring the repository signature.
 *
 * @returns Names of entries that are missing on either side or differ
 */
export async function diffNupkgContents(
  localPath: string,
  remotePath: string,
): Promise<string[]> {
  const [local, remote] = await Promise.all([
    readNupkgEntries(localPath),
    readNupkgEntries(remotePath),
  ]);
  const differences: string[] = [];
  for (const [name, fingerprint] of local) {
    if (remote.get(name) !== fingerprint) {
      differences.push(name);
    }
  }
  for (const name of remote.keys()) {
    if (!local.has(name)) {
      differences.push(name);
    }
  }
  return differences.sort();
}

/** Cache of resolved PackageBaseAddress URLs per service index */
const packageBaseAddressCache = new Map<string, Promise<string>>();

/**
 * Resolves the flat container (`PackageBaseAddress/3.0.0`) URL from a NuGet
 * v3 service index.
 */
export function resolvePackageBaseAddress(
  serviceIndexUrl: string,
): Promise<string> {
  let cached = packageBaseAddressCache.get(serviceIndexUrl);
  if (!cached) {
    cached = (async () => {
      const response = await fetch(serviceIndexUrl, {
        signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(
          `Failed to fetch NuGet service index ${serviceIndexUrl}: HTTP ${response.status}`,
        );
      }
      const index = (await response.json()) as {
        resources?: Array<{ '@id'?: string; '@type'?: string }>;
      };
      const resource = index.resources?.find(r =>
        r['@type']?.startsWith('PackageBaseAddress/3.0.0'),
      );
      if (!resource?.['@id']) {
        throw new Error(
          `NuGet service index ${serviceIndexUrl} has no PackageBaseAddress resource`,
        );
      }
      return resource['@id'].replace(/\/?$/, '/');
    })();
    // Don't cache failures, so a later call can retry
    cached.catch(() => packageBaseAddressCache.delete(serviceIndexUrl));
    packageBaseAddressCache.set(serviceIndexUrl, cached);
  }
  return cached;
}

/** Clears cached service index lookups. Used by tests. */
export function clearNugetRegistryCache(): void {
  packageBaseAddressCache.clear();
}

/**
 * Checks whether a package version is already published on a feed and, if
 * so, whether it matches the local .nupkg.
 *
 * The published package is downloaded from the feed's flat container and
 * compared entry by entry (SHA-256 of each file), ignoring the repository
 * signature the feed adds after upload. This lets a retried release skip packages
 * that were already uploaded, while still failing loudly if a different
 * package was published under the same version.
 */
export async function getRemotePackageState(
  serviceIndexUrl: string,
  nupkgPath: string,
): Promise<RemotePackageState> {
  try {
    const identity = await readNupkgIdentity(nupkgPath);
    const lowerId = identity.id.toLowerCase();
    const normalizedVersion = normalizeNugetVersion(identity.version);
    const baseAddress = await resolvePackageBaseAddress(serviceIndexUrl);
    const url = `${baseAddress}${lowerId}/${normalizedVersion}/${lowerId}.${normalizedVersion}.nupkg`;

    const response = await fetch(url, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (response.status === 404) {
      return { status: 'missing' };
    }
    if (!response.ok || !response.body) {
      return {
        status: 'unknown',
        reason: `HTTP ${response.status} from ${url}`,
      };
    }
    const body = response.body as WebReadableStream<Uint8Array>;

    return await withTempDir(async dir => {
      const remotePath = path.join(dir, path.basename(nupkgPath));
      await pipeline(Readable.fromWeb(body), createWriteStream(remotePath));
      const differences = await diffNupkgContents(nupkgPath, remotePath);
      return differences.length === 0
        ? { status: 'identical' as const, identity }
        : { status: 'different' as const, differences };
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.debug(`Could not check remote state of ${nupkgPath}: ${reason}`);
    return { status: 'unknown', reason };
  }
}

/**
 * Checks whether the symbol package for a package version is published.
 * Only nuget.org exposes symbol packages at a known location, so other
 * feeds always return `undefined` (unknown).
 */
export async function isSymbolPackagePublished(
  serviceIndexUrl: string,
  identity: NugetPackageIdentity,
): Promise<boolean | undefined> {
  if (
    serviceIndexUrl.replace(/\/+$/, '') !==
    NUGET_ORG_SERVICE_INDEX.replace(/\/+$/, '')
  ) {
    return undefined;
  }
  const lowerId = identity.id.toLowerCase();
  const url = `${NUGET_ORG_SYMBOL_PACKAGES_URL}/${lowerId}.${normalizeNugetVersion(identity.version)}.snupkg`;
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
    });
    if (response.ok) {
      return true;
    }
    if (response.status === 404) {
      return false;
    }
    logger.debug(`Unexpected HTTP ${response.status} from ${url}`);
    return undefined;
  } catch (error) {
    logger.debug(`Could not check symbol package at ${url}:`, error);
    return undefined;
  }
}
