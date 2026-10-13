import { readFileSync } from 'node:fs';
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
  expect(prepare.env).not.toHaveProperty('CRAFT_AI_API_KEY');
  const install = steps.find(
    (step: any) => step.name === 'Install Copilot summary runtime',
  );
  expect(steps.indexOf(install)).toBeLessThan(steps.indexOf(prepare));
  expect(install.run).toContain('--frozen-lockfile --ignore-scripts');
  expect(install.run).toContain('CRAFT_COPILOT_SDK_DIR=');
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

test('reusable release workflow grants Copilot access and forwards the optional alternative secret', () => {
  const workflow = yaml('.github/workflows/release.yml');
  expect(workflow.jobs.release.permissions['copilot-requests']).toBe('write');
  expect(workflow.on.workflow_call.secrets.CRAFT_AI_API_KEY.required).toBe(
    false,
  );
  for (const id of ['craft-local', 'craft-action']) {
    const step = workflow.jobs.release.steps.find(
      (step: any) => step.id === id,
    );
    expect(step.env.CRAFT_AI_API_KEY).toBe('${{ secrets.CRAFT_AI_API_KEY }}');
  }
});

test('live sample is manual-only, with read-only repository access and no model API key', () => {
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
  expect(sample.env).not.toHaveProperty('CRAFT_AI_API_KEY');
});
