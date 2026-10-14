import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

// Package Fossilize's output separately from the portable npm/legacy bundle.
for (const platform of [
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64',
  'linux-x64',
  'win-x64',
]) {
  const filename = `craft-${platform}${platform === 'win-x64' ? '.exe' : ''}`;
  const contents = await readFile(`dist-bin/${filename}`);
  const releaseName = platform === 'win-x64' ? filename : `${filename}.gz`;
  const releaseData =
    platform === 'win-x64' ? contents : gzipSync(contents, { level: 9 });
  if (releaseName !== filename)
    await writeFile(`dist-bin/${releaseName}`, releaseData);
  const checksum = createHash('sha256').update(releaseData).digest('hex');
  await writeFile(
    `dist-bin/${releaseName}.sha256`,
    `${checksum}  ${releaseName}\n`,
  );
}
