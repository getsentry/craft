import { describe, test, expect } from 'vitest';
import { load } from 'js-yaml';

import {
  generateCraftConfig,
  generateReleaseWorkflow,
  generateChangelogPreviewWorkflow,
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

      expect(parsed.minVersion).toBe('2.21.0');
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
        workflowSetup: { node: { packageManager: 'pnpm' } },
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
        workflowSetup: { python: { version: '3.11' } },
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
      expect((craftStep?.with as Record<string, unknown>).version).toBe(
        '${{ inputs.version }}',
      );
    });
  });

  describe('generateChangelogPreviewWorkflow', () => {
    test('generates changelog preview workflow with pull_request_target', () => {
      const yaml = generateChangelogPreviewWorkflow();
      const parsed = load(yaml) as Record<string, unknown>;

      expect(parsed.name).toBe('Changelog Preview');
      expect(parsed.on).toHaveProperty('pull_request_target');
    });

    test('uses craft reusable workflow', () => {
      const yaml = generateChangelogPreviewWorkflow();
      const parsed = load(yaml) as Record<string, unknown>;
      const job = (parsed.jobs as Record<string, unknown>)[
        'changelog-preview'
      ] as Record<string, unknown>;

      expect(job.uses).toBe(
        'getsentry/craft/.github/workflows/changelog-preview.yml@v2',
      );
      expect(job.secrets).toBe('inherit');
    });

    test('sets required permissions', () => {
      const yaml = generateChangelogPreviewWorkflow();
      const parsed = load(yaml) as Record<string, unknown>;
      const permissions = parsed.permissions as Record<string, string>;

      expect(permissions.contents).toBe('read');
      expect(permissions['pull-requests']).toBe('write');
    });
  });
});
