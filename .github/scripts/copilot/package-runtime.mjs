import console from 'node:console';
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { createRequire, isBuiltin } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { build } from 'esbuild';
import { create } from 'tar';
import { MAX_ARTIFACT_SIZE } from '../download-verified-artifact.mjs';

const require = createRequire(import.meta.url);
const sdkRoot = resolve(
  dirname(require.resolve('@github/copilot-sdk')),
  '../..',
);
const sdkPackage = JSON.parse(
  await readFile(join(sdkRoot, 'package.json'), 'utf8'),
);
// The pinned SDK's resolver selects the matching OS/CPU/libc package. Reuse it
// rather than duplicating its platform rules in our archive builder.
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
await writeFile(join(output, 'package.json'), '{"private":true}\n');
const sdkOutput = join(output, 'node_modules/@github/copilot-sdk');
await mkdir(sdkOutput, { recursive: true });
await writeFile(
  join(sdkOutput, 'package.json'),
  JSON.stringify({
    name: sdkPackage.name,
    version: sdkPackage.version,
    license: sdkPackage.license,
    main: 'index.cjs',
  }),
);

// Only the JS client and stdio factory are exposed in this private action
// distribution. Craft never uses the SDK's in-process FFI transport (koffi).
const bundle = await build({
  stdin: {
    contents: `export { CopilotClient } from './dist/client.js';
      import { RuntimeConnection as Connection } from './dist/types.js';
      export const RuntimeConnection = { forStdio: Connection.forStdio };`,
    resolveDir: sdkRoot,
  },
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node20.19',
  outfile: join(sdkOutput, 'index.cjs'),
  external: ['./ffiRuntimeHost.js'],
  minify: true,
  legalComments: 'external',
  metafile: true,
});
for (const artifact of Object.values(bundle.metafile.outputs)) {
  for (const dependency of artifact.imports) {
    if (
      dependency.external &&
      !isBuiltin(dependency.path) &&
      !(
        dependency.path === './ffiRuntimeHost.js' &&
        dependency.kind === 'dynamic-import'
      )
    )
      throw new Error(`Unexpected external SDK dependency: ${dependency.path}`);
  }
}

// Preserve notices from every bundled package, even though the original
// dependency directories, docs, declarations, and duplicate JS are omitted.
const roots = new Map();
for (const input of Object.keys(bundle.metafile.inputs)) {
  if (input === '<stdin>') continue;
  let directory = dirname(resolve(input));
  while (directory !== dirname(directory)) {
    const manifest = join(directory, 'package.json');
    if (existsSync(manifest)) {
      const pkg = JSON.parse(await readFile(manifest, 'utf8'));
      if (pkg.name) {
        roots.set(pkg.name, directory);
        break;
      }
    }
    directory = dirname(directory);
  }
}
for (const [name, directory] of roots) {
  for (const file of await readdir(directory)) {
    if (
      /^(?:licen[cs]e|notice|copyright|thirdpartynotices)(?:\.|$)/i.test(file)
    ) {
      const destination = join(
        output,
        'licenses',
        name.replaceAll('/', '__'),
        file,
      );
      await mkdir(dirname(destination), { recursive: true });
      await cp(join(directory, file), destination);
    }
  }
}
await mkdir(join(output, 'licenses/@github__copilot-sdk'), { recursive: true });
await cp(
  resolve('.github/scripts/copilot/SDK-LICENSE.txt'),
  join(output, 'licenses/@github__copilot-sdk/LICENSE'),
);

// Empty-mode sessions with tools disabled need the headless wrapper, runtime
// library, and its adjacent authentication libraries. No plugin/search/UI
// payloads, schemas, skills, extension SDK, or other platform builds are used.
const nativeOutput = join(output, 'node_modules', nativeName);
await mkdir(join(nativeOutput, 'prebuilds'), { recursive: true });
await cp(join(nativeRoot, 'package.json'), join(nativeOutput, 'package.json'));
await cp(
  join(nativeRoot, 'prebuilds', platform),
  join(nativeOutput, 'prebuilds', platform),
  { recursive: true, dereference: true },
);
const archive = resolve('dist/copilot-runtime.tar.gz');
await create(
  { gzip: true, file: archive, cwd: output, portable: true, noMtime: true },
  ['package.json', 'node_modules', 'licenses'],
);
const size = (await stat(archive)).size;
if (size > MAX_ARTIFACT_SIZE)
  throw new Error('Packaged Copilot runtime exceeds the download size limit');
console.log(
  `Packaged minimal Copilot runtime: ${platform} (${size} compressed bytes)`,
);
