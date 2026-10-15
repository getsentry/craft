import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  readdir,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { afterEach, expect, test, vi } from 'vitest';
import { installAgentSkills, getAgentSkillContent } from '../utils/agentSkills';
const state = vi.hoisted(() => ({ dry: false }));
vi.mock('../utils/helpers', () => ({ isDryRun: () => state.dry }));
const dirs: string[] = [];
afterEach(async () => {
  state.dry = false;
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true });
});
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'craft skills '));
  dirs.push(home);
  return { home, env: { XDG_CONFIG_HOME: join(home, 'config') } };
}
test('embedded skill has portable frontmatter and is pinned to the binary version', () => {
  const content = getAgentSkillContent('9.1.0');
  const header = load(content.split('---')[1]) as {
    name: string;
    description: string;
    metadata: { version: string };
  };
  expect(header.name).toBe('craft-cli');
  expect(header.description).toContain('Craft');
  expect(header.metadata.version).toBe('9.1.0');
  expect(content).toContain('craft prepare');
  expect(content).toContain('craft publish');
  expect(content).not.toContain('{{version}}');
});
test('does not create agent roots when no agent is detected', async () => {
  const { home, env } = await fixture();
  expect(await installAgentSkills(undefined, env, home)).toEqual([]);
  expect(await readdir(home)).toEqual([]);
});
test('installs the embedded skill to both detected roots and refreshes it without network', async () => {
  const { home, env } = await fixture();
  await mkdir(join(home, '.agents'));
  await mkdir(join(home, '.claude'));
  const paths = await installAgentSkills(undefined, env, home, '9.1.0');
  expect(paths).toHaveLength(2);
  for (const path of paths)
    expect(await readFile(path, 'utf8')).toContain('version: "9.1.0"');
  await installAgentSkills(undefined, env, home, '9.2.0');
  for (const path of paths)
    expect(await readFile(path, 'utf8')).toContain('version: "9.2.0"');
});
test('opt-out persists across later setup/update and can be explicitly re-enabled', async () => {
  const { home, env } = await fixture();
  await mkdir(join(home, '.agents'));
  expect(await installAgentSkills(false, env, home)).toEqual([]);
  expect(await installAgentSkills(undefined, env, home)).toEqual([]);
  expect(await readdir(join(home, '.agents'))).toEqual([]);
  expect(await installAgentSkills(true, env, home)).toHaveLength(1);
});
test('dry-run does not write preference or skill files', async () => {
  const { home, env } = await fixture();
  await mkdir(join(home, '.agents'));
  state.dry = true;
  await installAgentSkills(false, env, home);
  await installAgentSkills(true, env, home);
  expect(await readdir(home)).toEqual(['.agents']);
  expect(await readdir(join(home, '.agents'))).toEqual([]);
});
test('a custom skill is preserved while another writable target still installs', async () => {
  const { home, env } = await fixture();
  const dir = join(home, '.agents/skills/craft-cli');
  await mkdir(dir, { recursive: true });
  await mkdir(join(home, '.claude'));
  await writeFile(join(dir, 'SKILL.md'), 'custom skill');
  const paths = await installAgentSkills(undefined, env, home);
  expect(paths).toEqual([join(home, '.claude/skills/craft-cli/SKILL.md')]);
  expect(await readFile(join(dir, 'SKILL.md'), 'utf8')).toBe('custom skill');
});
test.skipIf(process.platform === 'win32')(
  'never follows a skill file symlink',
  async () => {
    const { home, env } = await fixture();
    const dir = join(home, '.agents/skills/craft-cli');
    await mkdir(dir, { recursive: true });
    const target = join(home, 'private');
    await writeFile(target, 'private');
    await symlink(target, join(dir, 'SKILL.md'));
    expect(await installAgentSkills(undefined, env, home)).toEqual([]);
    expect(await readFile(target, 'utf8')).toBe('private');
  },
);
test('invalid preference files fail closed without replacing user files', async () => {
  const { home, env } = await fixture();
  await mkdir(join(home, '.agents'));
  const folder = join(home, 'config/craft');
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, 'setup.json'), 'invalid');
  await expect(installAgentSkills(undefined, env, home)).rejects.toThrow(
    /preference/i,
  );
  expect(await readdir(join(home, '.agents'))).toEqual([]);
});
