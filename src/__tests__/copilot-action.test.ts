import {
  readFileSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { expect, test } from 'vitest';

const root = join(__dirname, '../..');
const yaml = (path: string): any =>
  load(readFileSync(join(root, path), 'utf8'));

test('direct action installs the pinned physical runtime and uses the built-in token', () => {
  const steps = yaml('action.yml').runs.steps;
  const prepare = steps.find((step: any) => step.name === 'Craft Prepare');
  expect(prepare.env.COPILOT_GITHUB_TOKEN).toBe('${{ github.token }}');
  const install = steps.find(
    (step: any) => step.name === 'Install Copilot summary runtime',
  );
  expect(steps.indexOf(install)).toBeLessThan(steps.indexOf(prepare));
  expect(install.run).toContain('install-copilot-runtime.mjs');
  expect(install['continue-on-error']).toBe(true);
  expect(
    steps.some(
      (step: any) =>
        step.uses?.startsWith('actions/setup-node') ||
        step.uses?.startsWith('pnpm/action-setup'),
    ),
  ).toBe(false);
  const installer = readFileSync(
    join(root, '.github/scripts/install-copilot-runtime.mjs'),
    'utf8',
  );
  expect(installer).toContain("'--frozen-lockfile'");
  expect(installer).toContain("'--ignore-scripts'");
  const helper = JSON.parse(
    readFileSync(join(root, '.github/copilot-sdk/package.json'), 'utf8'),
  );
  const packageData = JSON.parse(
    readFileSync(join(root, 'package.json'), 'utf8'),
  );
  expect(helper.dependencies['@github/copilot-sdk']).toBe(
    packageData.dependencies['@github/copilot-sdk'],
  );
});

test('reusable release workflow grants Copilot access', () => {
  const workflow = yaml('.github/workflows/release.yml');
  expect(workflow.jobs.release.permissions['copilot-requests']).toBe('write');
});

test('live sample is manual-only, with read-only repository access', () => {
  const job = yaml('.github/workflows/build.yml').jobs['copilot-sample'];
  expect(job.if).toBe(
    "github.event_name == 'workflow_dispatch' && inputs.copilot_sample",
  );
  expect(job.permissions).toEqual({
    contents: 'read',
    'copilot-requests': 'write',
  });
  const sample = job.steps.find(
    (step: any) =>
      step.name === 'Generate isolated release notes through Copilot',
  );
  expect(sample.env.COPILOT_GITHUB_TOKEN).toBe('${{ github.token }}');
});

test('authenticated probe suppresses native stderr and sanitizes startup failures', () => {
  const directory = mkdtempSync(join(tmpdir(), 'craft-probe-test-'));
  try {
    const module = join(directory, 'node_modules/@github/copilot-sdk');
    mkdirSync(module, { recursive: true });
    writeFileSync(join(directory, 'package.json'), '{"private":true}');
    writeFileSync(join(module, 'package.json'), '{"main":"index.cjs"}');
    writeFileSync(
      join(module, 'index.cjs'),
      `
      exports.RuntimeConnection = { forStdio: () => ({}) };
      exports.CopilotClient = class {
        async start() { process.stderr.write('private-runtime-secret'); throw new Error('private-runtime-secret'); }
        async forceStop() {}
      };
    `,
    );
    const probe = yaml('.github/workflows/build.yml').jobs[
      'copilot-sample'
    ].steps.find(
      (step: any) =>
        step.name ===
        'Probe Copilot authentication and Luna model availability',
    );
    const result = spawnSync('bash', ['-c', probe.run], {
      cwd: root,
      env: { ...process.env, CRAFT_COPILOT_SDK_DIR: directory },
      encoding: 'utf8',
      timeout: 20000,
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('{"runtimeProbeFailed":true}');
    expect(result.stdout).not.toContain('private-runtime-secret');
    expect(result.stderr).toBe('');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('private pnpm bootstrap rejects modified archives before executing an installer', () => {
  const directory = mkdtempSync(join(tmpdir(), 'craft-installer-test-'));
  try {
    const hook = join(directory, 'http-fixture.cjs');
    const output = join(directory, 'github-env');
    const pathFile = join(directory, 'github-path');
    writeFileSync(output, '');
    writeFileSync(pathFile, '');
    writeFileSync(
      hook,
      "globalThis.fetch = async () => new Response('modified-installer-payload');",
    );
    const result = spawnSync(
      process.execPath,
      [join(root, '.github/scripts/install-copilot-runtime.mjs')],
      {
        env: {
          ...process.env,
          NODE_OPTIONS: `--require=${hook}`,
          GITHUB_ENV: output,
          GITHUB_PATH: pathFile,
        },
        encoding: 'utf8',
        timeout: 20000,
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Copilot runtime installation failed');
    expect(result.stderr).not.toContain('modified-installer-payload');
    expect(readFileSync(output, 'utf8')).toBe('');
    expect(readFileSync(pathFile, 'utf8')).toBe('');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
