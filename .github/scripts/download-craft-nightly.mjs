#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const REGISTRY = 'https://ghcr.io';
const REPOSITORY = 'getsentry/craft';
const ARTIFACT_TYPE = 'application/vnd.getsentry.craft.binary.v1';
const MANIFEST_TYPE = 'application/vnd.oci.image.manifest.v1+json';
const MAX_BINARY_SIZE = 128 * 1024 * 1024;
const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

async function requestJson(request, url, headers, description) {
  const response = await request(url, {
    headers,
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`${description} failed (HTTP ${response.status})`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error(`${description} returned invalid JSON`);
  }
}

export async function downloadCraftNightly(tag, outputPath, request = fetch) {
  if (
    tag !== 'nightly' &&
    !/^nightly-(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(tag)
  ) {
    throw new Error('Invalid Craft nightly tag');
  }

  const auth = await requestJson(
    request,
    `${REGISTRY}/token?scope=repository:${REPOSITORY}:pull`,
    {},
    'GHCR token exchange',
  );
  if (typeof auth?.token !== 'string' || !auth.token) {
    throw new Error('GHCR token exchange returned no token');
  }
  const authorization = { Authorization: `Bearer ${auth.token}` };
  const manifest = await requestJson(
    request,
    `${REGISTRY}/v2/${REPOSITORY}/manifests/${tag}`,
    { ...authorization, Accept: MANIFEST_TYPE },
    'Craft nightly manifest lookup',
  );
  const revision = manifest?.annotations?.['org.opencontainers.image.revision'];
  const layers = manifest?.layers;
  if (
    manifest?.schemaVersion !== 2 ||
    manifest?.mediaType !== MANIFEST_TYPE ||
    manifest?.artifactType !== ARTIFACT_TYPE ||
    manifest?.annotations?.['org.opencontainers.image.source'] !==
      'https://github.com/getsentry/craft' ||
    typeof revision !== 'string' ||
    !SHA.test(revision) ||
    (tag !== 'nightly' && revision !== tag.slice('nightly-'.length)) ||
    !Array.isArray(layers) ||
    layers.length !== 1
  ) {
    throw new Error('Invalid Craft nightly manifest');
  }

  const [layer] = layers;
  if (
    layer?.annotations?.['org.opencontainers.image.title'] !== 'craft' ||
    layer?.mediaType !== 'application/octet-stream' ||
    typeof layer?.digest !== 'string' ||
    !/^sha256:[0-9a-f]{64}$/.test(layer.digest) ||
    !Number.isSafeInteger(layer.size) ||
    layer.size < 1 ||
    layer.size > MAX_BINARY_SIZE
  ) {
    throw new Error('Invalid Craft nightly binary layer');
  }

  const blob = await request(
    `${REGISTRY}/v2/${REPOSITORY}/blobs/${layer.digest}`,
    {
      headers: authorization,
      redirect: 'manual',
      signal: AbortSignal.timeout(120_000),
    },
  );
  const response = [302, 307].includes(blob.status)
    ? await (async () => {
        const location = blob.headers.get('location');
        if (!location || new URL(location).protocol !== 'https:') {
          throw new Error('Invalid Craft nightly blob redirect');
        }
        // GHCR redirects blobs to Azure. Never forward the GHCR bearer token.
        return await request(location, {
          redirect: 'error',
          signal: AbortSignal.timeout(120_000),
        });
      })()
    : blob;
  if (!response.ok || !response.body) {
    throw new Error(
      `Craft nightly binary download failed (HTTP ${response.status})`,
    );
  }

  const chunks = [];
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > layer.size || size > MAX_BINARY_SIZE) {
      throw new Error('Craft nightly binary exceeds its declared size');
    }
    hash.update(chunk);
    chunks.push(chunk);
  }
  if (size !== layer.size || `sha256:${hash.digest('hex')}` !== layer.digest) {
    throw new Error('Craft nightly binary digest or size mismatch');
  }

  await writeFile(outputPath, Buffer.concat(chunks, size), {
    flag: 'wx',
    mode: 0o600,
  });
  return revision;
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  if (process.argv.length !== 4) {
    console.error('Expected a Craft nightly tag and output file');
    process.exitCode = 1;
  } else {
    try {
      await downloadCraftNightly(process.argv[2], process.argv[3]);
    } catch (error) {
      console.error(`Unable to download Craft nightly: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
