/**
 * Template system for generating GitHub Actions workflows and .craft.yml files.
 *
 * Uses a simple AST-like structure that can be materialized into YAML.
 * This approach is more compact than storing full YAML templates and
 * allows for conditional sections based on project detection.
 */

import { dump } from 'js-yaml';
import { SMART_DEFAULTS_MIN_VERSION } from '../config';
import { TargetConfig } from '../schemas/project_config';
import { WorkflowSetup } from './detection';

/**
 * Context for generating templates
 */
export interface TemplateContext {
  /** GitHub owner */
  githubOwner: string;
  /** GitHub repo name */
  githubRepo: string;
  /** Detected targets */
  targets: TargetConfig[];
  /** Workflow setup (aggregated from targets) */
  workflowSetup?: WorkflowSetup;
}

/**
 * Generate a .craft.yml configuration file
 */
export function generateCraftConfig(context: TemplateContext): string {
  const config: Record<string, unknown> = {
    minVersion: SMART_DEFAULTS_MIN_VERSION,
  };

  // Sort targets by priority (already sorted from detection)
  if (context.targets.length > 0) {
    config.targets = context.targets.map(t => {
      // Clean up undefined values
      const cleanTarget: Record<string, unknown> = { name: t.name };
      for (const [key, value] of Object.entries(t)) {
        if (value !== undefined && key !== 'name') {
          cleanTarget[key] = value;
        }
      }
      return cleanTarget;
    });
  }

  return dump(config, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
  });
}

/**
 * Generate a GitHub Actions release workflow
 */
export function generateReleaseWorkflow(context: TemplateContext): string {
  const workflow: Record<string, unknown> = {
    name: 'Release',
    on: {
      workflow_dispatch: {
        inputs: {
          version: {
            description: 'Version to release (leave empty for auto)',
            required: false,
          },
        },
      },
    },
    jobs: {
      release: generateReleaseJob(context),
    },
  };

  return dump(workflow, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
    quotingType: '"',
    forceQuotes: false,
  });
}

/**
 * Generate the release job for the workflow
 */
function generateReleaseJob(context: TemplateContext): Record<string, unknown> {
  const steps: Record<string, unknown>[] = [];

  // Checkout
  steps.push({
    uses: 'actions/checkout@v4',
    with: {
      'fetch-depth': 0,
      token: '${{ secrets.GH_RELEASE_PAT }}',
    },
  });

  // Node.js setup (if needed)
  if (context.workflowSetup?.node) {
    if (context.workflowSetup.node.packageManager === 'pnpm') {
      steps.push({
        uses: 'pnpm/action-setup@v4',
      });
    }

    const nodeStep: Record<string, unknown> = {
      uses: 'actions/setup-node@v4',
      with: {
        cache: context.workflowSetup.node.packageManager,
      },
    };

    if (context.workflowSetup.node.versionFile) {
      nodeStep.with = {
        ...(nodeStep.with as Record<string, unknown>),
        'node-version-file': context.workflowSetup.node.versionFile,
      };
    }

    steps.push(nodeStep);
  }

  // Python setup (if needed)
  if (context.workflowSetup?.python) {
    const pythonStep: Record<string, unknown> = {
      uses: 'actions/setup-python@v5',
    };

    if (context.workflowSetup.python.version) {
      pythonStep.with = {
        'python-version': context.workflowSetup.python.version,
      };
    }

    steps.push(pythonStep);
  }

  // Craft action
  steps.push({
    uses: 'getsentry/craft@v2',
    with: {
      version: '${{ inputs.version }}',
    },
    env: {
      GITHUB_TOKEN: '${{ secrets.GH_RELEASE_PAT }}',
    },
  });

  return {
    'runs-on': 'ubuntu-latest',
    steps,
  };
}

/**
 * Generate a changelog preview workflow for PRs
 *
 * Uses pull_request_target to allow posting comments on PRs from forks.
 * Calls the reusable workflow from getsentry/craft.
 */
export function generateChangelogPreviewWorkflow(): string {
  const workflow: Record<string, unknown> = {
    name: 'Changelog Preview',
    on: {
      pull_request_target: {
        types: [
          'opened',
          'synchronize',
          'reopened',
          'edited',
          'labeled',
          'unlabeled',
        ],
      },
    },
    permissions: {
      contents: 'read',
      'pull-requests': 'write',
    },
    jobs: {
      'changelog-preview': {
        uses: 'getsentry/craft/.github/workflows/changelog-preview.yml@v2',
        secrets: 'inherit',
      },
    },
  };

  return dump(workflow, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
    quotingType: '"',
    forceQuotes: false,
  });
}
