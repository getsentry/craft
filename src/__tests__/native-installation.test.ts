import {
  mkdtemp,
  readdir,
  readFile,
  writeFile,
  rm,
  symlink,
  mkdir,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, test, vi } from 'vitest';
import { safeFs } from '../utils/dryRun';
import {
  getInstallDirectory,
  getNativeFilename,
  installNativeBinary,
} from '../utils/nativeInstallation';

const state = vi.hoisted(() => ({ dry: false }));
vi.mock('../utils/helpers', () => ({ isDryRun: () => state.dry }));
const directories: string[] = [];
afterEach(async () => {
  state.dry = false;
  vi.restoreAllMocks();
  for (const path of directories.splice(0))
    await rm(path, { recursive: true, force: true });
});
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'craft install '));
  directories.push(dir);
  const source = join(dir, 'source');
  const target = join(dir, 'bin', 'craft');
  await writeFile(source, 'new');
  await mkdir(join(dir, 'bin'));
  await writeFile(target, 'old');
  return { dir, source, target };
}
test('replaces an installation and cleans its stage and lock', async () => {
  const { source, target } = await fixture();
  expect((await installNativeBinary(source, target)).path).toBe(target);
  expect(await readFile(target, 'utf8')).toBe('new');
  expect(await readdir(join(target, '..'))).toEqual(['craft']);
});
test('a dry run neither stages nor replaces the installation', async () => {
  const { source, target } = await fixture();
  state.dry = true;
  await installNativeBinary(source, target);
  expect(await readFile(target, 'utf8')).toBe('old');
});
test('rejects an existing lock without touching the installation', async () => {
  const { source, target } = await fixture();
  await mkdir(join(target, '..', '.craft-install.lock'));
  await expect(installNativeBinary(source, target)).rejects.toThrow(
    /lock|progress/,
  );
  expect(await readFile(target, 'utf8')).toBe('old');
});
test.skipIf(process.platform === 'win32')(
  'rejects symlink destinations',
  async () => {
    const { dir, source, target } = await fixture();
    const link = join(dir, 'link');
    await symlink(target, link);
    await expect(installNativeBinary(source, link)).rejects.toThrow(/symlink/);
    expect(await readFile(target, 'utf8')).toBe('old');
  },
);
test('restores the original when Windows replacement fails after backup rename', async () => {
  const { source, target } = await fixture();
  const rename = safeFs.rename;
  let calls = 0;
  vi.spyOn(safeFs, 'rename').mockImplementation(async (from, to) => {
    if (++calls === 2) throw new Error('replacement denied');
    return rename(from, to);
  });
  await expect(installNativeBinary(source, target, 'win32')).rejects.toThrow(
    'replacement denied',
  );
  expect(await readFile(target, 'utf8')).toBe('old');
});
test('rejects unsupported platforms and preserves Sentry-style directory preferences', () => {
  expect(getNativeFilename('win32', 'x64')).toBe('craft.exe');
  expect(() => getNativeFilename('win32', 'arm64')).toThrow(/Unsupported/);
  expect(() => getNativeFilename('linux', 'ia32')).toThrow(/Unsupported/);
  expect(
    getInstallDirectory({ CRAFT_INSTALL_DIR: '/custom' }, '/home/test'),
  ).toBe('/custom');
  expect(getInstallDirectory({ XDG_BIN_HOME: '/xdg' }, '/home/test')).toBe(
    '/xdg',
  );
  expect(
    getInstallDirectory({ XDG_BIN_HOME: 'relative', PATH: '' }, '/home/test'),
  ).toBe(join('/home/test', '.local/bin'));
});
