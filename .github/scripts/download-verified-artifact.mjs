import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

export const MAX_ARTIFACT_SIZE = 128 * 1024 * 1024;

export function validArtifactMetadata(asset) {
  return (
    typeof asset?.digest === 'string' &&
    /^sha256:[0-9a-f]{64}$/.test(asset.digest) &&
    Number.isSafeInteger(asset.size) &&
    asset.size > 0 &&
    asset.size <= MAX_ARTIFACT_SIZE
  );
}

/** Share size/digest enforcement for release and nightly runtime artifacts. */
export async function writeVerifiedArtifact(
  response,
  output,
  asset,
  description,
) {
  if (!validArtifactMetadata(asset))
    throw new Error(`Invalid ${description} metadata`);
  if (!response.ok || !response.body)
    throw new Error(`${description} download failed (HTTP ${response.status})`);
  const chunks = [];
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > asset.size)
      throw new Error(`${description} exceeds its declared size`);
    hash.update(chunk);
    chunks.push(chunk);
  }
  if (size !== asset.size || `sha256:${hash.digest('hex')}` !== asset.digest)
    throw new Error(`${description} digest or size mismatch`);
  await writeFile(output, Buffer.concat(chunks, size), {
    flag: 'wx',
    mode: 0o600,
  });
}
