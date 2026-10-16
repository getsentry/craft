import { afterAll, beforeAll, expect, test } from 'vitest';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = resolve(__dirname, '../..');
let cli: string;
const offlineTransport = resolve(__dirname, 'fixtures/offline-telemetry.cjs');
let directory: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'craft lifecycle '));
  const build = join(directory, 'build');
  await mkdir(build);
  for (const source of ['src', 'skills', 'build.mjs', 'package.json'])
    await cp(join(root, source), join(build, source), { recursive: true });
  await symlink(
    join(root, 'node_modules'),
    join(build, 'node_modules'),
    'junction',
  );
  await execFileAsync(process.execPath, ['build.mjs'], {
    cwd: build,
    env: { PATH: process.env.PATH, SENTRY_AUTH_TOKEN: '' },
    timeout: 60000,
    killSignal: 'SIGKILL',
  });
  cli = join(build, 'dist/craft');
  await writeFile(
    join(directory, '.craft.yml'),
    'github:\n  owner: example\n  repo: fixture\ntargets:\n  - name: github\n',
  );
}, 60000);
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});
const run = (...args: string[]) =>
  execFileAsync(process.execPath, [cli, ...args], {
    cwd: directory,
    env: {
      PATH: process.env.PATH,
      HOME: directory,
      CI: 'true',
      NODE_OPTIONS: `--require=${JSON.stringify(offlineTransport)}`,
    },
    timeout: 5000,
    killSignal: 'SIGKILL',
  });
test('targets exits naturally when telemetry cannot connect', async () => {
  const { stdout, stderr } = await run('targets', '--no-input');
  expect(JSON.parse(stdout)).toEqual(['github']);
  expect(stderr).not.toContain('[Sentry]');
}, 10000);
test('config exits naturally when telemetry cannot connect', async () => {
  const { stdout, stderr } = await run('config', '--no-input');
  expect(JSON.parse(stdout).github).toEqual({
    owner: 'example',
    repo: 'fixture',
  });
  expect(stderr).not.toContain('[Sentry]');
}, 10000);
test('invalid configuration retains a failing exit status', async () => {
  await writeFile(join(directory, '.craft.yml'), 'targets: invalid\n');
  await expect(run('config', '--no-input')).rejects.toMatchObject({
    code: 1,
    killed: false,
  });
}, 10000);
