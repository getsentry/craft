import console from 'node:console';
import { chmod, cp, mkdir, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { create } from 'tar';
import { MAX_ARTIFACT_SIZE } from '../download-verified-artifact.mjs';

const require = createRequire(import.meta.url);
const sdkRoot = resolve(
  dirname(require.resolve('@github/copilot-sdk')),
  '../..',
);
// Reuse the pinned SDK's OS/CPU/libc selection instead of duplicating its rules.
const {
  getRuntimePlatform,
  getRuntimePackageName,
  resolvePackageRoot,
} = require(join(sdkRoot, 'dist/cjs/runtimeArtifacts.js'));
const platform = getRuntimePlatform();
const nativeName = getRuntimePackageName(platform);
const nativeRoot = resolvePackageRoot(
  nativeName,
  createRequire(join(sdkRoot, 'package.json')).resolve.paths(nativeName),
);
if (!nativeRoot)
  throw new Error(`Missing native Copilot package: ${nativeName}`);
const output = resolve('dist/copilot-runtime');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
// JavaScript is already bundled into Craft. This archive contains only the
// matching headless executable, runtime library, adjacent auth libraries, and
// native package notices. Empty-mode sessions use no plugin/search/UI assets.
await cp(join(nativeRoot, 'prebuilds', platform), join(output, 'runtime'), {
  recursive: true,
  dereference: true,
});
const wrapper = platform.startsWith('win32')
  ? 'copilot-runtime.exe'
  : 'copilot-runtime';
await chmod(join(output, 'runtime', wrapper), 0o755);
await mkdir(join(output, 'licenses'), { recursive: true });
await cp(
  resolve('.github/scripts/copilot/SDK-LICENSE.txt'),
  join(output, 'licenses/Copilot-LICENSE.txt'),
);
// Ensure we never produce an archive with a missing/empty wrapper or library.
for (const file of [wrapper, 'runtime.node'])
  if (!(await stat(join(output, 'runtime', file))).size)
    throw new Error(`Empty Copilot runtime asset: ${file}`);
const archive = resolve('dist/copilot-runtime.tar.gz');
await create(
  { gzip: true, file: archive, cwd: output, portable: true, noMtime: true },
  ['runtime', 'licenses'],
);
const size = (await stat(archive)).size;
if (size > MAX_ARTIFACT_SIZE)
  throw new Error('Packaged Copilot runtime exceeds the download size limit');
console.log(
  `Packaged native Copilot runtime: ${platform} (${size} compressed bytes)`,
);
