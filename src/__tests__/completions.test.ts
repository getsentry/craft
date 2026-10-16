import { execFileSync } from 'node:child_process';
import {
  mkdtemp,
  chmod,
  mkdir,
  readFile,
  writeFile,
  rm,
  readdir,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { getCompletionScript, installCompletions } from '../utils/completions';
const state = vi.hoisted(() => ({ dry: false }));
vi.mock('../utils/helpers', () => ({ isDryRun: () => state.dry }));
const directories: string[] = [];
afterEach(async () => {
  state.dry = false;
  for (const dir of directories.splice(0))
    await rm(dir, { recursive: true, force: true });
});
async function home() {
  const dir = await mkdtemp(join(tmpdir(), 'craft completion '));
  directories.push(dir);
  return dir;
}
test.each(['bash', 'zsh', 'fish'])(
  'prints %s integration for both npm aliases using CLI metadata',
  shell => {
    const script = getCompletionScript(shell);
    expect(script).toContain('craft');
    expect(script).toContain('sentry-craft');
    expect(script).toContain('--get-yargs-completions');
    expect(script).not.toContain('mapfile');
  },
);
test('rejects unsupported shells', () =>
  expect(() => getCompletionScript('powershell')).toThrow(/shell/));
test('installs Bash completion into absolute XDG data paths without touching profiles', async () => {
  const dir = await home();
  const data = join(dir, 'xdg data');
  const profile = join(dir, '.bashrc');
  await writeFile(profile, 'user profile');
  const paths = await installCompletions('bash', { XDG_DATA_HOME: data }, dir);
  expect(paths).toHaveLength(2);
  expect(paths[0]).toBe(join(data, 'bash-completion/completions/craft'));
  expect(await readFile(paths[0], 'utf8')).toContain('--get-yargs-completions');
  expect(await readFile(profile, 'utf8')).toBe('user profile');
  await installCompletions('bash', { XDG_DATA_HOME: data }, dir);
  expect(await readdir(join(data, 'bash-completion/completions'))).toEqual([
    'craft',
    'sentry-craft',
  ]);
});
test('installs zsh and fish with portable defaults and ignores relative XDG paths', async () => {
  const dir = await home();
  expect(
    (await installCompletions('zsh', { XDG_DATA_HOME: 'relative' }, dir))[0],
  ).toBe(join(dir, '.local/share/zsh/site-functions/_craft'));
  expect((await installCompletions('fish', {}, dir))[0]).toBe(
    join(dir, '.config/fish/completions/craft.fish'),
  );
});
test('dry-run creates no directory or completion files', async () => {
  const dir = await home();
  state.dry = true;
  await installCompletions('bash', {}, dir);
  expect(await readdir(dir)).toEqual([]);
});
test('preserves a custom completion file', async () => {
  const dir = await home();
  const folder = join(dir, '.local/share/bash-completion/completions');
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, 'craft'), 'custom');
  await expect(installCompletions('bash', {}, dir)).rejects.toThrow(
    /custom|managed/i,
  );
  expect(await readFile(join(folder, 'craft'), 'utf8')).toBe('custom');
});
test.skipIf(process.platform === 'win32')(
  'rejects symlink completion targets',
  async () => {
    const dir = await home();
    const folder = join(dir, '.local/share/bash-completion/completions');
    await mkdir(folder, { recursive: true });
    const target = join(dir, 'user');
    await writeFile(target, 'user');
    await symlink(target, join(folder, 'craft'));
    await expect(installCompletions('bash', {}, dir)).rejects.toThrow(
      /symlink/,
    );
    expect(await readFile(target, 'utf8')).toBe('user');
  },
);

test.skipIf(process.platform === 'win32')(
  'Bash completes at the cursor when later arguments have choice values',
  async () => {
    const dir = await home();
    const cli = join(dir, 'mock cli');
    const script = join(dir, 'completion.bash');
    await writeFile(
      cli,
      '#!/bin/bash\nif [[ $# == 4 && "$4" == --sh ]]; then echo --shell; else echo Info; fi\n',
    );
    await chmod(cli, 0o755);
    await writeFile(script, getCompletionScript('bash'));
    const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
    const result = execFileSync(
      'bash',
      [
        '-c',
        `source ${quote(script)}; COMP_WORDS=(${quote(cli)} setup --sh --log-level Info); COMP_CWORD=2; _craft_completion; printf '%s\\n' "\${COMPREPLY[@]}"`,
      ],
      { encoding: 'utf8' },
    );
    expect(result.trim()).toBe('--shell');
  },
);
