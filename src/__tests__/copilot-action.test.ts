import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { BaseTarget } from '../targets/base';
import { NoneArtifactProvider } from '../artifact_providers/none';
import type { RemoteArtifact } from '../artifact_providers/base';
import { expect, test, vi } from 'vitest';

const root = join(__dirname, '../..');
const yaml = (path: string): any =>
  load(readFileSync(join(root, path), 'utf8'));

test('action consumes the prebuilt runtime and authenticates with its built-in token', () => {
  const steps = yaml('action.yml').runs.steps;
  const runtime = steps.find((step: any) => step.id === 'copilot-runtime');
  expect(runtime.continueOnError ?? runtime['continue-on-error']).toBe(true);
  expect(runtime.run).toContain('unpack-runtime.mjs');
  expect(runtime.env.CRAFT_VERSION).toBe(
    '${{ steps.craft-install.outputs.version }}',
  );
  const prepare = steps.find((step: any) => step.name === 'Craft Prepare');
  expect(prepare.env.COPILOT_GITHUB_TOKEN).toBe('${{ github.token }}');
  expect(prepare.env.CRAFT_COPILOT_RUNTIME_PATH).toContain(
    'steps.copilot-runtime.outputs.path',
  );
  expect(prepare.env).not.toHaveProperty('CRAFT_COPILOT_INSTALLER');
  expect(
    steps.some((step: any) => /pnpm|npm|install-copilot/.test(step.run || '')),
  ).toBe(false);
  expect(
    steps.some(
      (step: any) =>
        step.uses?.startsWith('actions/setup-node') ||
        step.uses?.startsWith('pnpm/action-setup'),
    ),
  ).toBe(false);
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  expect(pkg.devDependencies['@github/copilot-sdk']).toBe('1.0.21');
  expect(pkg.dependencies).not.toHaveProperty('@github/copilot-sdk');
});

test('reusable workflow inherits optional Copilot permission from its caller', () => {
  const workflow = yaml('.github/workflows/release.yml');
  expect(workflow.jobs.release.permissions).toBeUndefined();
});

test.each(['build.yml', 'release-build.yml'])(
  'publishes the prebuilt runtime alongside Craft in %s',
  name => {
    const build = yaml(`.github/workflows/${name}`).jobs.build;
    expect(
      build.steps.some((step: any) => step.run === 'pnpm build:copilot'),
    ).toBe(true);
    expect(
      build.steps.find((step: any) => step.name === 'Upload Build Artifact')
        .with.path,
    ).toContain('dist/copilot-runtime.tar.gz');
  },
);

test('runtime release asset does not produce an unpublished CDN registry link', async () => {
  const configuration = yaml('.craft.yml');
  const provider = new NoneArtifactProvider();
  const artifacts = [
    'craft',
    'sentry-craft-2.35.0.tgz',
    'gh-pages.zip',
    'copilot-runtime.tar.gz',
  ].map(filename => ({ filename }) as RemoteArtifact);
  vi.spyOn(provider, 'listArtifactsForRevision').mockResolvedValue(artifacts);
  const target = (name: string) =>
    new BaseTarget(
      configuration.targets.find((config: any) => config.name === name),
      provider,
    );
  const registry = await target('registry').getArtifactsForRevision('revision');
  const cdn = await target('gcs').getArtifactsForRevision('revision');
  expect(registry.map(artifact => artifact.filename)).toEqual(
    cdn.map(artifact => artifact.filename),
  );
  const github = await target('github').getArtifactsForRevision('revision');
  expect(github.map(artifact => artifact.filename)).toContain(
    'copilot-runtime.tar.gz',
  );
});
