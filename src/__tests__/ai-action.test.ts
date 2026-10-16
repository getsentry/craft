import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { expect, test } from 'vitest';
const root = join(__dirname, '../..');
const yaml = (path: string): any =>
  load(readFileSync(join(root, path), 'utf8'));

test('Craft has no Copilot package or separate runtime build', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  for (const dependencies of [pkg.dependencies, pkg.devDependencies])
    expect(
      Object.keys(dependencies).some(name =>
        name.startsWith('@github/copilot'),
      ),
    ).toBe(false);
  expect(pkg.scripts).not.toHaveProperty('build:copilot');
  expect(
    readFileSync(join(root, 'src/utils/ai-provider.ts'), 'utf8'),
  ).not.toContain('copilot-sdk');
});

test('Action maps structured settings and an explicit credential to the shared CLI path', () => {
  const action = yaml('action.yml');
  expect(action.inputs.llm).toBeDefined();
  expect(action.inputs.llm_api_key).toBeDefined();
  const prepare = action.runs.steps.find(
    (step: any) => step.name === 'Craft Prepare',
  );
  expect(prepare.env.CRAFT_AI_LLM).toBe(
    '${{ inputs.llm || env.CRAFT_AI_LLM }}',
  );
  expect(prepare.env.AI_SUMMARY_TOKEN).toBe(
    '${{ inputs.llm_api_key || env.AI_SUMMARY_TOKEN }}',
  );
  expect(prepare.env.LLM_API_KEY_INPUT_SET).toContain(
    "inputs.llm_api_key != ''",
  );
  expect(prepare.run).toContain('--ai-api-key-env AI_SUMMARY_TOKEN');
  expect(JSON.stringify(action)).not.toMatch(
    /copilot-bridge|copilot-runtime|pnpm|unpack-runtime/,
  );
  expect(prepare.env).not.toHaveProperty('COPILOT_GITHUB_TOKEN');
  // Runner metadata evaluation does not expose workflow vars inside a composite.
  expect(JSON.stringify(action)).not.toContain('vars.');
});

test('reusable workflow forwards structured connection and optional secret to both Action paths', () => {
  const workflow = yaml('.github/workflows/release.yml');
  expect(workflow.on.workflow_call.secrets.llm_api_key.required).toBe(false);
  for (const step of workflow.jobs.release.steps.filter((step: any) =>
    ['craft-local', 'craft-action'].includes(step.id),
  )) {
    expect(step.with.llm).toBe('${{ inputs.llm || vars.CRAFT_AI_LLM }}');
    expect(step.with.llm_api_key).toBe(
      step.id === 'craft-local'
        ? '${{ secrets.llm_api_key || github.token }}'
        : '${{ secrets.llm_api_key }}',
    );
  }
});

test.each(['build.yml', 'release-build.yml'])(
  'ordinary Craft artifacts contain no native runtime in %s',
  name => {
    const build = yaml(`.github/workflows/${name}`).jobs.build;
    expect(
      build.steps.find((step: any) => step.name === 'Upload Build Artifact')
        .with.path,
    ).not.toContain('copilot');
  },
);

test('CLI E2E runs in the ordinary Node suites without extra AI platform jobs', () => {
  const workflow = yaml('.github/workflows/build.yml');
  expect(workflow.jobs).not.toHaveProperty('ai-summary-platforms');
  const job = workflow.jobs.test;
  expect(job['runs-on']).toBe('ubuntu-latest');
  expect(job.strategy.matrix).toEqual({ node: ['22', '24'] });
  expect(job.steps.find((step: any) => step.name === 'Test').run).toBe(
    'pnpm test',
  );
});
