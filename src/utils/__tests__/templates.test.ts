import { describe, test, expect } from 'vitest';
import { load } from 'js-yaml';

import {
  generateCraftConfig,
  generateReleaseWorkflow,
  generateChangelogPreviewWorkflow,
  generatePublishWorkflow,
  TemplateContext,
} from '../templates';

describe('Template Generation', () => {
  const baseContext: TemplateContext = {
    githubOwner: 'getsentry',
    githubRepo: 'test-repo',
    targets: [{ name: 'npm' }, { name: 'github' }],
  };

  describe('generateCraftConfig', () => {
    test('generates minimal config', () => {
      const yaml = generateCraftConfig(baseContext);
      const parsed = load(yaml) as Record<string, unknown>;

      expect(parsed.minVersion).toBe('2.20.0');
      expect(parsed.targets).toHaveLength(2);
    });

    test('includes all target properties', () => {
      const context: TemplateContext = {
        ...baseContext,
        targets: [
          { name: 'npm', workspaces: true },
          { name: 'docker', source: 'ghcr.io/test/repo', target: 'test/repo' },
          { name: 'github' },
        ],
      };

      const yaml = generateCraftConfig(context);
      const parsed = load(yaml) as Record<string, unknown>;
      const targets = parsed.targets as Record<string, unknown>[];

      expect(targets[0]).toEqual({ name: 'npm', workspaces: true });
      expect(targets[1]).toEqual({
        name: 'docker',
        source: 'ghcr.io/test/repo',
        target: 'test/repo',
      });
    });
  });

  describe('generateReleaseWorkflow', () => {
    test('generates basic workflow structure', () => {
      const yaml = generateReleaseWorkflow(baseContext);
      const parsed = load(yaml) as Record<string, unknown>;

      expect(parsed.name).toBe('Release');
      expect(parsed.on).toHaveProperty('workflow_dispatch');
      expect(parsed.jobs).toHaveProperty('release');
    });

    test('includes checkout step', () => {
      const yaml = generateReleaseWorkflow(baseContext);
      const parsed = load(yaml) as Record<string, unknown>;
      const job = (parsed.jobs as Record<string, unknown>).release as Record<
        string,
        unknown
      >;
      const steps = job.steps as Record<string, unknown>[];

      const checkoutStep = steps.find(s =>
        (s.uses as string)?.includes('checkout'),
      );
      expect(checkoutStep).toBeDefined();
      expect(
        (checkoutStep?.with as Record<string, unknown>)['fetch-depth'],
      ).toBe(0);
    });

    test('includes pnpm setup for pnpm projects', () => {
      const context: TemplateContext = {
        ...baseContext,
        nodeSetup: { packageManager: 'pnpm' },
      };

      const yaml = generateReleaseWorkflow(context);
      const parsed = load(yaml) as Record<string, unknown>;
      const job = (parsed.jobs as Record<string, unknown>).release as Record<
        string,
        unknown
      >;
      const steps = job.steps as Record<string, unknown>[];

      const pnpmStep = steps.find(s =>
        (s.uses as string)?.includes('pnpm/action-setup'),
      );
      expect(pnpmStep).toBeDefined();
    });

    test('includes Python setup for Python projects', () => {
      const context: TemplateContext = {
        ...baseContext,
        pythonSetup: { version: '3.11' },
      };

      const yaml = generateReleaseWorkflow(context);
      const parsed = load(yaml) as Record<string, unknown>;
      const job = (parsed.jobs as Record<string, unknown>).release as Record<
        string,
        unknown
      >;
      const steps = job.steps as Record<string, unknown>[];

      const pythonStep = steps.find(s =>
        (s.uses as string)?.includes('setup-python'),
      );
      expect(pythonStep).toBeDefined();
      expect(
        (pythonStep?.with as Record<string, unknown>)['python-version'],
      ).toBe('3.11');
    });

    test('includes Craft action', () => {
      const yaml = generateReleaseWorkflow(baseContext);
      const parsed = load(yaml) as Record<string, unknown>;
      const job = (parsed.jobs as Record<string, unknown>).release as Record<
        string,
        unknown
      >;
      const steps = job.steps as Record<string, unknown>[];

      const craftStep = steps.find(s =>
        (s.uses as string)?.includes('getsentry/craft'),
      );
      expect(craftStep).toBeDefined();
      expect((craftStep?.with as Record<string, unknown>).action).toBe(
        'prepare',
      );
    });
  });

  describe('generateChangelogPreviewWorkflow', () => {
    test('generates changelog preview workflow', () => {
      const yaml = generateChangelogPreviewWorkflow();
      const parsed = load(yaml) as Record<string, unknown>;

      expect(parsed.name).toBe('Changelog Preview');
      expect(parsed.on).toHaveProperty('pull_request');
    });

    test('uses craft changelog-preview action', () => {
      const yaml = generateChangelogPreviewWorkflow();
      const parsed = load(yaml) as Record<string, unknown>;
      const job = (parsed.jobs as Record<string, unknown>).preview as Record<
        string,
        unknown
      >;
      const steps = job.steps as Record<string, unknown>[];

      const craftStep = steps.find(s =>
        (s.uses as string)?.includes('getsentry/craft'),
      );
      expect(craftStep).toBeDefined();
      expect((craftStep?.with as Record<string, unknown>).action).toBe(
        'changelog-preview',
      );
    });
  });

  describe('generatePublishWorkflow', () => {
    test('generates publish workflow', () => {
      const yaml = generatePublishWorkflow(baseContext);
      const parsed = load(yaml) as Record<string, unknown>;

      expect(parsed.name).toBe('Publish');
      expect((parsed.on as Record<string, unknown>).push).toBeDefined();
    });

    test('triggers on CHANGELOG.md changes', () => {
      const yaml = generatePublishWorkflow(baseContext);
      const parsed = load(yaml) as Record<string, unknown>;
      const push = (parsed.on as Record<string, unknown>).push as Record<
        string,
        unknown
      >;

      expect(push.paths).toContain('CHANGELOG.md');
    });

    test('includes NPM_TOKEN for npm targets', () => {
      const yaml = generatePublishWorkflow(baseContext);
      const parsed = load(yaml) as Record<string, unknown>;
      const job = (parsed.jobs as Record<string, unknown>).publish as Record<
        string,
        unknown
      >;
      const steps = job.steps as Record<string, unknown>[];

      const craftStep = steps.find(s =>
        (s.uses as string)?.includes('getsentry/craft'),
      );
      expect(
        (craftStep?.env as Record<string, unknown>).NPM_TOKEN,
      ).toBeDefined();
    });

    test('includes TWINE secrets for pypi targets', () => {
      const context: TemplateContext = {
        ...baseContext,
        targets: [{ name: 'pypi' }, { name: 'github' }],
      };

      const yaml = generatePublishWorkflow(context);
      const parsed = load(yaml) as Record<string, unknown>;
      const job = (parsed.jobs as Record<string, unknown>).publish as Record<
        string,
        unknown
      >;
      const steps = job.steps as Record<string, unknown>[];

      const craftStep = steps.find(s =>
        (s.uses as string)?.includes('getsentry/craft'),
      );
      expect(
        (craftStep?.env as Record<string, unknown>).TWINE_USERNAME,
      ).toBeDefined();
      expect(
        (craftStep?.env as Record<string, unknown>).TWINE_PASSWORD,
      ).toBeDefined();
    });

    test('includes CRATES_IO_TOKEN for crates targets', () => {
      const context: TemplateContext = {
        ...baseContext,
        targets: [{ name: 'crates' }, { name: 'github' }],
      };

      const yaml = generatePublishWorkflow(context);
      const parsed = load(yaml) as Record<string, unknown>;
      const job = (parsed.jobs as Record<string, unknown>).publish as Record<
        string,
        unknown
      >;
      const steps = job.steps as Record<string, unknown>[];

      const craftStep = steps.find(s =>
        (s.uses as string)?.includes('getsentry/craft'),
      );
      expect(
        (craftStep?.env as Record<string, unknown>).CRATES_IO_TOKEN,
      ).toBeDefined();
    });
  });
});
