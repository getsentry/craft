// Install a native build/release while preserving pre-native and GHCR compatibility.
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  appendFile,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { downloadCraftNightly } from './download-craft-nightly.mjs';

const repository = 'https://github.com/getsentry/craft/releases/download';
const maxDownload = 256 * 1024 * 1024;
const maxExecutable = 512 * 1024 * 1024;
async function readOptional(path) {
  if (!path) return undefined;
  try {
    return await readFile(path);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
async function download(url, request, limit) {
  const response = await request(url, {
    signal: AbortSignal.timeout(180000),
    headers: { 'User-Agent': 'craft-action-installer' },
  });
  if (!response.ok)
    throw new Error(`Craft download failed (HTTP ${response.status})`);
  if (!response.body) throw new Error('Empty Craft download');
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw new Error('Craft download exceeds size limit');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}
function verifyExecutable(path, version, platform) {
  if (platform === 'darwin')
    execFileSync('codesign', ['--verify', '--strict', path], {
      timeout: 30000,
    });
  const actual = execFileSync(path, ['--version'], {
    timeout: 30000,
    maxBuffer: 4096,
    env: { ...process.env, NODE_OPTIONS: '' },
  })
    .toString()
    .trim()
    .replace(/ \([0-9a-f]{40}\)$/i, '');
  if (actual !== version)
    throw new Error(
      `Craft executable version ${actual} does not match ${version}`,
    );
}
export async function installCraft({
  version,
  directory,
  artifactDirectory,
  legacyArtifact,
  expectedVersion,
  platform = process.platform,
  arch = process.arch,
  request = fetch,
  verify = verifyExecutable,
}) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(version))
    throw new Error('Invalid Craft release tag');
  const supported =
    (['linux', 'darwin'].includes(platform) &&
      ['x64', 'arm64'].includes(arch)) ||
    (platform === 'win32' && arch === 'x64');
  const asset = supported
    ? `craft-${platform === 'win32' ? 'win' : platform}-${arch}${platform === 'win32' ? '.exe' : '.gz'}`
    : undefined;
  let data =
    asset && artifactDirectory
      ? await readOptional(join(artifactDirectory, asset))
      : undefined;
  let native = data !== undefined;
  let selectedVersion = expectedVersion;
  if (!data) data = await readOptional(legacyArtifact);
  if (!data && !version.startsWith('nightly')) {
    const endpoint =
      version === 'latest' ? 'latest' : `tags/${encodeURIComponent(version)}`;
    const release = JSON.parse(
      (
        await download(
          `https://api.github.com/repos/getsentry/craft/releases/${endpoint}`,
          request,
          1024 * 1024,
        )
      ).toString('utf8'),
    );
    if (
      release.draft !== false ||
      typeof release.tag_name !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(release.tag_name) ||
      (version !== 'latest' && release.tag_name !== version) ||
      !Array.isArray(release.assets)
    )
      throw new Error('Invalid Craft release metadata');
    selectedVersion = release.tag_name;
    const candidates = release.assets.filter(item => item.name === asset);
    if (candidates.length > 1) throw new Error('Duplicate Craft native asset');
    native = candidates.length === 1;
    const name = native ? asset : 'craft';
    const matches = release.assets.filter(
      item => item.name === name && item.state === 'uploaded',
    );
    const url = `${repository}/${encodeURIComponent(selectedVersion)}/${name}`;
    if (matches.length !== 1 || matches[0].browser_download_url !== url)
      throw new Error('Missing or invalid Craft asset URL');
    data = await download(url, request, maxDownload);
  }
  await mkdir(directory, { recursive: true });
  const stage = await mkdtemp(join(directory, '.craft-'));
  const staged = join(stage, platform === 'win32' ? 'craft.exe' : 'craft');
  try {
    if (!data) {
      await downloadCraftNightly(version, staged, request);
    } else {
      const bytes =
        native && platform !== 'win32'
          ? gunzipSync(data, { maxOutputLength: maxExecutable })
          : data;
      if (!bytes.length || bytes.length > maxExecutable)
        throw new Error('Invalid Craft executable size');
      await writeFile(staged, bytes, { mode: 0o755 });
    }
    await chmod(staged, 0o755);
    if (native) {
      if (!selectedVersion) throw new Error('Missing native artifact version');
      verify(staged, selectedVersion, platform);
    }
    const path = join(
      directory,
      platform === 'win32' && native ? 'craft.exe' : 'craft',
    );
    await rename(staged, path);
    return { path, native, version: selectedVersion };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const [version, directory] = process.argv.slice(2);
    if (!version || !directory)
      throw new Error('Expected Craft version and installation directory');
    const result = await installCraft({
      version,
      directory,
      artifactDirectory:
        process.env.CRAFT_NATIVE_ARTIFACT_DIRECTORY || undefined,
      legacyArtifact: process.env.CRAFT_LEGACY_ARTIFACT || undefined,
      expectedVersion: process.env.CRAFT_ARTIFACT_VERSION || undefined,
    });
    if (process.env.GITHUB_PATH)
      await appendFile(process.env.GITHUB_PATH, `${directory}\n`);
    console.log(
      `Installed ${result.native ? 'native' : 'JavaScript'} Craft${result.version ? ` ${result.version}` : ''}: ${result.path}`,
    );
  } catch (error) {
    console.error(`Unable to install Craft: ${error.message}`);
    process.exitCode = 1;
  }
}
