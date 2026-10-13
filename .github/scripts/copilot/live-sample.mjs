import process from 'node:process';
import console from 'node:console';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Real bundled CLI + real Copilot SDK/auth/inference. Only GitHub source
// metadata is simulated; all git writes stay in an isolated temporary repo.
const binary = resolve('dist/craft');
const here = dirname(fileURLToPath(import.meta.url));
const directory = await mkdtemp(join(tmpdir(), 'craft-copilot-live-'));
const output = resolve(process.env.RUNNER_TEMP || directory, 'copilot-sample');
await mkdir(output, { recursive: true });
const git = (...args) =>
  execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim();
try {
  git('init', '--initial-branch=main');
  git('config', 'user.name', 'Craft E2E Sample');
  git('config', 'user.email', 'sample@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  await writeFile(
    join(directory, '.craft.yml'),
    `github:
  owner: getsentry
  repo: craft
changelog:
  policy: auto
  aiSummary:
    enabled: true
    kickInThreshold: 0
    levels: [release, category, scope]
targets: []
`,
  );
  await writeFile(
    join(directory, 'package.json'),
    '{"name":"craft-copilot-sample","version":"1.0.0"}',
  );
  git('add', '.');
  git('commit', '-m', 'Initial sample');
  git('tag', '1.0.0');
  for (const [prefix, scope, title] of [
    ['feat', 'cli', 'Add command'],
    ['fix', 'api', 'Fix endpoint'],
  ])
    for (let index = 1; index <= 6; index++) {
      await writeFile(
        join(directory, `${scope}-${index}.txt`),
        `${title} ${index}`,
      );
      git('add', '.');
      git('commit', '-m', `${prefix}(${scope}): ${title} ${index}`);
    }
  const env = {
    ...process.env,
    // The adapter sends COPILOT_GITHUB_TOKEN, not this hook, into its child.
    NODE_OPTIONS: `--require=${join(here, 'github-fixture.cjs')}`,
    CRAFT_WORKSPACE: '',
    CRAFT_DRY_RUN: 'false',
    DRY_RUN: 'false',
  };
  const run = (...args) =>
    JSON.parse(
      execFileSync(
        binary,
        [
          'changelog',
          '--since',
          '1.0.0',
          '--format',
          'json',
          '--no-input',
          ...args,
        ],
        {
          cwd: directory,
          env,
          encoding: 'utf8',
          timeout: 150000,
          maxBuffer: 1024 * 1024,
        },
      ),
    );
  const original = run('--dry-run');
  const generated = run();
  await writeFile(join(output, 'original.md'), original.changelog);
  await writeFile(join(output, 'copilot.md'), generated.changelog);
  assert.equal(generated.bumpType, 'minor');
  assert.equal(original.bumpType, generated.bumpType);
  for (const title of ['Add command', 'Fix endpoint'])
    for (let index = 1; index <= 6; index++)
      assert.ok(generated.changelog.includes(`${title} ${index}`));
  assert.equal(
    (generated.changelog.match(/<details>/g) || []).length,
    4,
    'No live summaries: check organization billing policy, token permission, and Luna availability',
  );
  assert.ok(generated.changelog.includes('**New Features ✨:**'));
  assert.ok(generated.changelog.includes('**Bug Fixes 🐛:**'));
  assert.notEqual(original.changelog, generated.changelog);
  // Exercise omitted/empty defaults with the real provider too.
  const configFile = join(directory, '.craft.yml');
  await writeFile(
    configFile,
    (await readFile(configFile, 'utf8')).replace(
      '    levels: [release, category, scope]',
      '    levels: []',
    ),
  );
  const release = run();
  assert.ok(!release.changelog.includes('<details>'));
  assert.ok(release.changelog.includes('**New Features ✨:**'));
  assert.ok(release.changelog.includes('**Bug Fixes 🐛:**'));
  await writeFile(join(output, 'release-only.md'), release.changelog);
  console.log(
    'Isolated Copilot CLI sample passed; runtime provenance is determined by the workflow configuration.',
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
