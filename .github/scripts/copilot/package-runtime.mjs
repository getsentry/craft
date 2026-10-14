import process from 'node:process';
import console from 'node:console';
import { cp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { create } from 'tar';

// Package only the SDK dependency tree, never Craft's other build dependencies.
const output = resolve('dist/copilot-runtime');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await writeFile(join(output, 'package.json'), '{"private":true}\n');
const copied = new Map();
async function copyPackage(name, from, optional = false) {
  const require = createRequire(from);
  const candidate = require.resolve
    .paths(name)
    .map(path => join(path, name))
    .find(path => existsSync(join(path, 'package.json')));
  if (!candidate) {
    if (optional) return;
    throw new Error(`Missing runtime dependency: ${name}`);
  }
  const source = await realpath(candidate);
  const pkg = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
  if (copied.has(name)) {
    if (copied.get(name) !== pkg.version)
      throw new Error(`Conflicting dependency: ${name}`);
    return;
  }
  copied.set(name, pkg.version);
  const destination = join(output, 'node_modules', name);
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination, {
    recursive: true,
    dereference: true,
    filter: path =>
      path === source ||
      !path
        .slice(source.length + 1)
        .split(/[\\/]/)
        .includes('node_modules'),
  });
  for (const dependency of Object.keys(pkg.dependencies || {}))
    await copyPackage(dependency, join(source, 'package.json'));
  for (const dependency of Object.keys(pkg.optionalDependencies || {}))
    await copyPackage(dependency, join(source, 'package.json'), true);
}
await copyPackage('@github/copilot-sdk', resolve('package.json'));
await create(
  {
    gzip: true,
    file: resolve('dist/copilot-runtime.tar.gz'),
    cwd: output,
    portable: true,
    noMtime: true,
  },
  ['package.json', 'node_modules'],
);
console.log(`Packaged Copilot runtime: ${process.platform}/${process.arch}`);
