import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { fossilize } from 'fossilize';

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const host = `${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`;
const platforms = (process.argv[2] || host).split(',');
const supported = [
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64',
  'linux-x64',
  'win-x64',
];
if (
  process.argv.length > 3 ||
  platforms.some(platform => !supported.includes(platform))
) {
  throw new Error(
    `Expected a comma-separated list of platforms: ${supported.join(', ')}`,
  );
}

// Keep the npm/legacy JS bundle outside the directory Fossilize clears.
await fossilize(
  {
    nodeVersion: pkg.volta.node,
    platforms,
    outputName: 'craft',
    outDir: 'dist-bin',
    cacheDir: '.node-cache',
    noBundle: true,
    noCodeCache: true,
    sign: false,
    holePunch: false,
    concurrencyLimit: 3,
  },
  'dist/craft',
);

for (const platform of new Set(platforms)) {
  const filename = `craft-${platform}${platform.startsWith('win') ? '.exe' : ''}`;
  const contents = await readFile(`dist-bin/${filename}`);
  const releaseName = platform.startsWith('win') ? filename : `${filename}.gz`;
  const releaseData = platform.startsWith('win')
    ? contents
    : gzipSync(contents, { level: 9 });
  if (releaseName !== filename)
    await writeFile(`dist-bin/${releaseName}`, releaseData);
  const checksum = createHash('sha256').update(releaseData).digest('hex');
  await writeFile(
    `dist-bin/${releaseName}.sha256`,
    `${checksum}  ${releaseName}\n`,
  );
}
