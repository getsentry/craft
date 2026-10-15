import { isSea } from 'node:sea';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gunzipSync, zstdDecompressSync } from 'node:zlib';
import semver from 'semver';
import {
  applyPatchToMemory,
  offtin,
  extractStableChain,
  MAX_STABLE_CHAIN_DEPTH,
  parsePatchHeader,
  SIZE_THRESHOLD_RATIO,
  type GitHubRelease,
} from 'binpatch';
import { getPackage } from './version';
import { getNativeFilename, installNativeBinary } from './nativeInstallation';
import { safeExec, safeFs, safeFsPromises } from './dryRun';
import { isDryRun } from './helpers';
import { logger } from '../logger';

const REPOSITORY = 'https://github.com/getsentry/craft/releases/download';
const MAX_BINARY_BYTES = 256 * 1024 * 1024;
const MAX_EXECUTABLE_BYTES = 512 * 1024 * 1024;
interface Release {
  version: string;
  filename: string;
  url: string;
  rawDigest?: string;
  compressedSize?: number;
}
interface UpdateOptions {
  version?: string;
  check?: boolean;
  force?: boolean;
}
interface Runtime {
  executable: string;
  currentVersion: string;
  native: boolean;
  platform: string;
  arch: string;
}
function validateVersion(version: string): void {
  const parsed = semver.parse(version);
  const canonical =
    parsed &&
    `${parsed.version}${parsed.build.length ? `+${parsed.build.join('.')}` : ''}`;
  if (canonical !== version)
    throw new Error(`Invalid release version: ${version}`);
}
// Keep one timeout alive through body consumption, not only until headers arrive.
async function download(url: string, limit: number): Promise<Buffer> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(180000),
    headers: { 'User-Agent': 'craft-native-updater' },
  });
  if (!response.ok)
    throw new Error(`Download failed (HTTP ${response.status}): ${url}`);
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel();
    throw new Error(`Download exceeds size limit: ${url}`);
  }
  if (!response.body) throw new Error(`Empty response body: ${url}`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit)
        throw new Error(`Download exceeds size limit: ${url}`);
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  return Buffer.concat(chunks, length);
}
export async function resolveNativeRelease(
  version?: string,
  platform = process.platform as string,
  arch = process.arch as string,
): Promise<Release> {
  getNativeFilename(platform, arch);
  if (version !== undefined) validateVersion(version);
  const endpoint =
    version === undefined ? 'latest' : `tags/${encodeURIComponent(version)}`;
  const metadata: unknown = JSON.parse(
    (
      await download(
        `https://api.github.com/repos/getsentry/craft/releases/${endpoint}`,
        1024 * 1024,
      )
    ).toString('utf8'),
  );
  if (!metadata || typeof metadata !== 'object')
    throw new Error('Invalid release metadata');
  const release = metadata as {
    tag_name?: unknown;
    draft?: unknown;
    prerelease?: unknown;
    assets?: unknown;
  };
  if (typeof release.tag_name !== 'string')
    throw new Error('Invalid release tag');
  validateVersion(release.tag_name);
  if (
    release.draft !== false ||
    typeof release.prerelease !== 'boolean' ||
    (version === undefined &&
      (release.prerelease || semver.prerelease(release.tag_name))) ||
    (version !== undefined && release.tag_name !== version)
  )
    throw new Error(
      'Release tag/version is not the requested published release',
    );
  const filename = `craft-${platform === 'win32' ? 'win' : platform}-${arch}${platform === 'win32' ? '.exe' : '.gz'}`;
  const url = `${REPOSITORY}/${encodeURIComponent(release.tag_name)}/${filename}`;
  if (!Array.isArray(release.assets)) throw new Error('Missing release assets');
  for (const [name, expectedUrl] of [[filename, url]]) {
    const matches = release.assets.filter(
      asset => asset && typeof asset === 'object' && asset.name === name,
    );
    let actualUrl: URL;
    try {
      if (
        matches.length !== 1 ||
        typeof matches[0].browser_download_url !== 'string'
      )
        throw new Error();
      actualUrl = new URL(matches[0].browser_download_url);
      const expected = new URL(expectedUrl);
      if (
        actualUrl.origin !== expected.origin ||
        actualUrl.username ||
        actualUrl.password ||
        actualUrl.search ||
        actualUrl.hash ||
        decodeURIComponent(actualUrl.pathname) !==
          decodeURIComponent(expected.pathname)
      )
        throw new Error();
    } catch {
      throw new Error(`Missing or invalid release asset: ${name}`);
    }
  }
  const rawName = filename.replace(/\.gz$/, '');
  const raw = release.assets.find(asset => asset?.name === rawName);
  const compressed = release.assets.find(
    asset => asset?.name === `${rawName}.gz`,
  );
  return {
    rawDigest: /^sha256:[a-f0-9]{64}$/i.test(raw?.digest)
      ? raw.digest.slice(7).toLowerCase()
      : undefined,
    compressedSize:
      Number.isSafeInteger(compressed?.size) &&
      compressed.size > 0 &&
      compressed.size <= MAX_BINARY_BYTES
        ? compressed.size
        : undefined,
    version: release.tag_name,
    filename,
    url,
  };
}

// binpatch 0.4.2 trusts decoded control lengths and streams eagerly. Validate
// every compressed block before application, including unused trailing data.
function validateNativePatch(patch: Buffer): void {
  const { controlLen, diffLen, newSize } = parsePatchHeader(patch);
  if (newSize > MAX_EXECUTABLE_BYTES)
    throw new Error('Patch output exceeds executable size limit');
  const control = zstdDecompressSync(patch.subarray(32, 32 + controlLen), {
    maxOutputLength: 16 * 1024 * 1024,
  });
  if (control.length % 24 !== 0)
    throw new Error('Invalid patch control tuples');
  let diffBytes = 0;
  let extraBytes = 0;
  let oldPosition = 0;
  for (let offset = 0; offset < control.length; offset += 24) {
    const diff = offtin(control, offset);
    const extra = offtin(control, offset + 8);
    const seek = offtin(control, offset + 16);
    if (
      ![diff, extra, seek].every(Number.isSafeInteger) ||
      diff < 0 ||
      extra < 0 ||
      diff + extra > newSize - diffBytes - extraBytes
    )
      throw new Error('Patch control exceeds declared output');
    diffBytes += diff;
    extraBytes += extra;
    oldPosition += diff + seek;
    if (!Number.isSafeInteger(oldPosition))
      throw new Error('Invalid patch source offset');
  }
  if (diffBytes + extraBytes !== newSize)
    throw new Error('Patch output size mismatch');
  for (const [compressed, size] of [
    [patch.subarray(32 + controlLen, 32 + controlLen + diffLen), diffBytes],
    [patch.subarray(32 + controlLen + diffLen), extraBytes],
  ] as const) {
    if (
      zstdDecompressSync(compressed, { maxOutputLength: Math.max(1, size) })
        .length !== size
    )
      throw new Error('Patch block size mismatch');
  }
}

// Patches are an optimization: every failure falls back to the verified archive.
async function tryNativePatch(
  release: Release,
  runtime: Runtime,
  candidate: string,
): Promise<boolean> {
  if (
    !release.rawDigest ||
    !release.compressedSize ||
    semver.prerelease(release.version) ||
    semver.prerelease(runtime.currentVersion)
  )
    return false;
  try {
    const metadata: unknown = JSON.parse(
      (
        await download(
          `https://api.github.com/repos/getsentry/craft/releases?per_page=${MAX_STABLE_CHAIN_DEPTH + 2}`,
          1024 * 1024,
        )
      ).toString('utf8'),
    );
    if (!Array.isArray(metadata)) return false;
    const releases: GitHubRelease[] = metadata.filter(
      item => item?.draft === false && item?.prerelease === false,
    );
    for (const item of releases) {
      validateVersion(item.tag_name);
      if (!Array.isArray(item.assets)) return false;
    }
    const binaryName = release.filename.replace(/\.gz$/, '');
    const chain = extractStableChain({
      releases,
      binaryName,
      currentVersion: runtime.currentVersion,
      targetVersion: release.version,
      fullGzSize: release.compressedSize,
    });
    if ('failure' in chain || chain.expectedSha256 !== release.rawDigest)
      return false;
    const patches: Buffer[] = [];
    let budget = Math.floor(release.compressedSize * SIZE_THRESHOLD_RATIO);
    for (const [index, url] of chain.patchUrls.entries()) {
      const expected = new URL(
        `${REPOSITORY}/${encodeURIComponent(chain.steps[index].toVersion)}/${binaryName}.patch`,
      );
      const actual = new URL(url);
      if (
        actual.origin !== expected.origin ||
        actual.username ||
        actual.password ||
        actual.search ||
        actual.hash ||
        decodeURIComponent(actual.pathname) !==
          decodeURIComponent(expected.pathname)
      )
        throw new Error('Invalid patch asset URL');
      const patch = await download(url, budget);
      budget -= patch.length;
      validateNativePatch(patch);
      patches.push(patch);
    }
    if ((await lstat(runtime.executable)).size > MAX_EXECUTABLE_BYTES)
      return false;
    let bytes: Uint8Array = await readFile(runtime.executable);
    for (const patch of patches) bytes = await applyPatchToMemory(bytes, patch);
    if (createHash('sha256').update(bytes).digest('hex') !== release.rawDigest)
      throw new Error('Patched executable checksum mismatch');
    // Keep all writes inside Craft's staging directory and dry-run abstraction.
    await safeFs.writeFile(candidate, bytes, { mode: 0o700 });
    logger.info(`Applied ${patches.length} binary delta patch(es).`);
    return true;
  } catch (error) {
    logger.debug(
      `Delta update unavailable; downloading the full binary: ${String(error)}`,
    );
    return false;
  }
}

export async function updateNativeBinary(
  options: UpdateOptions,
  runtime: Runtime = {
    executable: process.execPath,
    currentVersion: getPackage().version,
    native: isSea(),
    platform: process.platform,
    arch: process.arch,
  },
): Promise<void> {
  if (!runtime.native)
    throw new Error(
      'Use npm/pnpm to update this JavaScript installation: pnpm add -g @sentry/craft',
    );
  if (/[/\\]Cellar[/\\]craft[/\\]/i.test(runtime.executable))
    throw new Error(
      'Use Homebrew to update this installation: brew upgrade getsentry/tools/craft',
    );
  const release = await resolveNativeRelease(
    options.version,
    runtime.platform,
    runtime.arch,
  );
  validateVersion(runtime.currentVersion);
  const comparison = semver.compare(release.version, runtime.currentVersion);
  logger.info(
    `Installed Craft ${runtime.currentVersion}; release ${release.version}`,
  );
  if (options.check || isDryRun()) {
    logger.info(
      `${isDryRun() ? '[dry-run] ' : ''}No executable files changed.`,
    );
    return;
  }
  if (comparison <= 0 && !options.force) {
    if (comparison < 0 && options.version !== undefined)
      throw new Error('Downgrading requires --force');
    logger.info('Craft is up to date. Use --force to reinstall or downgrade.');
    return;
  }
  const before = await lstat(runtime.executable);
  if (before.isSymbolicLink() || !before.isFile())
    throw new Error('Refusing to update a symlink or non-file executable');
  const root = await safeExec(
    () => mkdtemp(join(tmpdir(), 'craft-update-')),
    'Create updater staging directory',
  );
  if (!root) return;
  try {
    const candidate = join(
      root,
      getNativeFilename(runtime.platform, runtime.arch),
    );
    if (!(await tryNativePatch(release, runtime, candidate))) {
      const archive = await download(release.url, MAX_BINARY_BYTES);
      const bytes =
        runtime.platform === 'win32'
          ? archive
          : gunzipSync(archive, { maxOutputLength: MAX_EXECUTABLE_BYTES });
      if (bytes.length === 0) throw new Error('Empty executable');
      await safeFs.writeFile(candidate, bytes, { mode: 0o700 });
    }
    await safeFsPromises.chmod(candidate, 0o700);
    if (runtime.platform === 'darwin')
      execFileSync('codesign', ['--verify', '--strict', candidate], {
        timeout: 30000,
      });
    const actualVersion = execFileSync(candidate, ['--version'], {
      timeout: 30000,
      maxBuffer: 4096,
    })
      .toString()
      .trim()
      .replace(/ \([0-9a-f]{40}\)$/i, '');
    if (actualVersion !== release.version)
      throw new Error(
        `Candidate version ${actualVersion} differs from release version ${release.version}`,
      );
    await installNativeBinary(
      candidate,
      runtime.executable,
      runtime.platform,
      async () => {
        const current = await lstat(runtime.executable);
        if (
          current.ino !== before.ino ||
          current.size !== before.size ||
          current.mtimeMs !== before.mtimeMs ||
          current.ctimeMs !== before.ctimeMs
        )
          throw new Error(
            'Craft changed during the update. Run the installed Craft again.',
          );
      },
    );
    logger.info(`Updated Craft to ${release.version}: ${runtime.executable}`);
  } finally {
    await safeFs.rm(root, { recursive: true, force: true });
  }
}
