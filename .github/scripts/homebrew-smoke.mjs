// Run only on disposable CI runners: never publish or edit getsentry/tools.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { load } from 'js-yaml';
import mustache from 'mustache';

assert.equal(
  process.env.GITHUB_ACTIONS,
  'true',
  'This test installs into Homebrew on disposable CI runners only',
);
const execute = promisify(execFile);
const platform = `${process.platform}-${process.arch}`;
const filename = `craft-${platform}.gz`;
const archive = resolve('dist-bin', filename);
const digest = createHash('sha256')
  .update(await readFile(archive))
  .digest('hex');
const checksums = {};
for (const target of [
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64',
  'linux-x64',
]) {
  checksums[`craft-${target}__gz`] =
    target === platform ? digest : '0'.repeat(64);
}
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const config = load(await readFile('.craft.yml', 'utf8'));
const template = config.targets.find(target => target.name === 'brew').template;
const version = pkg.version.split('-')[0];
const formula = mustache
  .render(template, { version, checksums })
  .replace(
    `https://github.com/getsentry/craft/releases/download/${version}/${filename}`,
    pathToFileURL(archive).href,
  );
assert(
  formula.includes(pathToFileURL(archive).href),
  'Formula did not select the local archive',
);
const env = {
  ...process.env,
  HOMEBREW_NO_AUTO_UPDATE: '1',
  HOMEBREW_NO_INSTALL_CLEANUP: '1',
  HOMEBREW_NO_INSTALLED_DEPENDENTS_CHECK: '1',
  HOMEBREW_NO_INSTALL_UPGRADE: '1',
  HOMEBREW_NO_ANALYTICS: '1',
};
const brew = async (...args) => {
  const result = await execute('brew', args, {
    env,
    timeout: 600000,
    maxBuffer: 1024 * 1024,
  });
  console.log(result.stdout);
  return result.stdout.trim();
};
await brew('tap-new', '--no-git', 'craft-ci/native');
await brew('trust', '--tap', 'craft-ci/native');
try {
  const tap = await brew('--repository', 'craft-ci/native');
  await writeFile(join(tap, 'Formula/craft.rb'), formula);
  // Install declared dependencies too, matching the user installation path.
  await brew('install', '--formula', 'craft-ci/native/craft');
  await brew('test', 'craft-ci/native/craft');
  const prefix = await brew('--prefix', 'craft-ci/native/craft');
  const { stdout } = await execute(join(prefix, 'bin/craft'), ['--help'], {
    env,
    timeout: 30000,
  });
  assert.match(stdout, /prepare/);
  console.log(`Homebrew installed and tested the local ${platform} executable`);
} finally {
  await brew('uninstall', '--force', 'craft-ci/native/craft').catch(() => {});
  await brew('untap', 'craft-ci/native');
}
