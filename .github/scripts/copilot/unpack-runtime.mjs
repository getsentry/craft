import process from 'node:process';
import console from 'node:console';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdtemp, rm, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { downloadCraftNightly } from '../download-craft-nightly.mjs';

const { fetch, AbortSignal } = globalThis;
const MAX_SIZE = 128 * 1024 * 1024;
const execute = promisify(execFile);

export async function downloadReleaseRuntime(version, output, request = fetch) {
  if (
    version !== 'latest' &&
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)
  )
    throw new Error('Invalid Craft release version');
  const endpoint = version === 'latest' ? 'latest' : `tags/${version}`;
  const metadata = await request(
    `https://api.github.com/repos/getsentry/craft/releases/${endpoint}`,
    {
      signal: AbortSignal.timeout(30000),
      redirect: 'error',
    },
  );
  if (!metadata.ok) throw new Error('Runtime release lookup failed');
  const release = await metadata.json();
  if (
    typeof release.tag_name !== 'string' ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(release.tag_name) ||
    (version !== 'latest' && release.tag_name !== version)
  )
    throw new Error('Runtime release version mismatch');
  const assets = release.assets?.filter(
    asset => asset.name === 'copilot-runtime.tar.gz',
  );
  const asset = assets?.[0];
  if (
    assets?.length !== 1 ||
    !/^sha256:[a-f0-9]{64}$/.test(asset.digest) ||
    !Number.isSafeInteger(asset.size) ||
    asset.size < 1 ||
    asset.size > MAX_SIZE ||
    asset.browser_download_url !==
      `https://github.com/getsentry/craft/releases/download/${release.tag_name}/copilot-runtime.tar.gz`
  )
    throw new Error('Invalid runtime release asset');
  const response = await request(asset.browser_download_url, {
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok || !response.body)
    throw new Error('Runtime download failed');
  const chunks = [];
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > asset.size) throw new Error('Runtime exceeds declared size');
    hash.update(chunk);
    chunks.push(chunk);
  }
  if (size !== asset.size || `sha256:${hash.digest('hex')}` !== asset.digest)
    throw new Error('Runtime integrity mismatch');
  await writeFile(output, Buffer.concat(chunks, size), { flag: 'wx' });
}

export async function unpackRuntime(archive, directory) {
  // Our build emits only regular files/directories, never links. Reject unsafe
  // paths and links before invoking the system tar supplied by Actions runners.
  const options = { timeout: 60000, maxBuffer: 16 * 1024 * 1024 };
  const { stdout: names } = await execute('tar', ['-tzf', archive], options);
  const entries = names.trim().split(/\r?\n/);
  if (
    !entries.length ||
    entries.some(
      name =>
        !/^(?:package\.json$|node_modules(?:\/|$))/.test(name) ||
        name.includes('\\') ||
        name.split('/').some(part => part === '..' || part === '.'),
    )
  )
    throw new Error('Unsafe runtime archive path');
  const { stdout: listing } = await execute('tar', ['-tvzf', archive], options);
  if (
    listing
      .trim()
      .split(/\r?\n/)
      .some(line => !/^[d-]/.test(line))
  )
    throw new Error('Runtime archive links are forbidden');
  await execute('tar', ['-xzf', archive, '-C', directory], options);
  const pkg = JSON.parse(
    await readFile(
      join(directory, 'node_modules/@github/copilot-sdk/package.json'),
      'utf8',
    ),
  );
  if (typeof pkg.version !== 'string') throw new Error('Missing packaged SDK');
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const directory = await mkdtemp(
    join(process.env.RUNNER_TEMP || tmpdir(), 'craft-copilot-bundle-'),
  );
  try {
    const [version, artifact] = process.argv.slice(2);
    const archive =
      version === 'artifact' ? artifact : join(directory, 'runtime.tar.gz');
    if (version?.startsWith('nightly'))
      await downloadCraftNightly(
        version,
        archive,
        fetch,
        'copilot-runtime.tar.gz',
      );
    else if (version !== 'artifact')
      await downloadReleaseRuntime(version, archive);
    await unpackRuntime(archive, directory);
    if (version !== 'artifact') await rm(archive);
    await appendFile(process.env.GITHUB_OUTPUT, `directory=${directory}\n`);
  } catch {
    await rm(directory, { recursive: true, force: true });
    console.error(
      '::warning::Bundled Copilot runtime unavailable; original changelog will be preserved.',
    );
    process.exitCode = 1;
  }
}
