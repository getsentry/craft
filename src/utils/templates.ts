/**
 * Template system for generating GitHub Actions workflows and .craft.yml files.
 *
 * Uses a simple AST-like structure that can be materialized into YAML.
 * This approach is more compact than storing full YAML templates and
 * allows for conditional sections based on project detection.
 */

import { dump } from 'js-yaml';
import { TargetConfig } from '../schemas/project_config';

/**
 * Detected project setup for Node.js
 */
export interface NodeSetup {
  /** Package manager: npm, pnpm, or yarn */
  packageManager: 'npm' | 'pnpm' | 'yarn';
  /** Node version file path (e.g., .nvmrc, package.json volta) */
  versionFile?: string;
}

/**
 * Detected project setup for Python
 */
export interface PythonSetup {
  /** Python version */
  version?: string;
}

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
  /** Node.js setup (if detected) */
  nodeSetup?: NodeSetup;
  /** Python setup (if detected) */
  pythonSetup?: PythonSetup;
  /** Name of the CI workflow/job to wait for */
  ciJobName?: string;
  /** Whether there's a Dockerfile */
  hasDocker?: boolean;
}

/**
 * Generate a .craft.yml configuration file
 */
export function generateCraftConfig(context: TemplateContext): string {
  const config: Record<string, unknown> = {
    minVersion: '2.20.0',
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
          'dry-run': {
            description: 'Dry run (skip actual publish)',
            type: 'boolean',
            default: false,
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
  if (context.nodeSetup) {
    if (context.nodeSetup.packageManager === 'pnpm') {
      steps.push({
        uses: 'pnpm/action-setup@v4',
      });
    }

    const nodeStep: Record<string, unknown> = {
      uses: 'actions/setup-node@v4',
      with: {
        cache: context.nodeSetup.packageManager,
      },
    };

    if (context.nodeSetup.versionFile) {
      nodeStep.with = {
        ...(nodeStep.with as Record<string, unknown>),
        'node-version-file': context.nodeSetup.versionFile,
      };
    }

    steps.push(nodeStep);
  }

  // Python setup (if needed)
  if (context.pythonSetup) {
    const pythonStep: Record<string, unknown> = {
      uses: 'actions/setup-python@v5',
    };

    if (context.pythonSetup.version) {
      pythonStep.with = {
        'python-version': context.pythonSetup.version,
      };
    }

    steps.push(pythonStep);
  }

  // Craft action
  steps.push({
    uses: 'getsentry/craft@v2',
    with: {
      action: 'prepare',
      version: '${{ inputs.version }}',
      'dry-run': '${{ inputs.dry-run }}',
    },
    env: {
      GH_TOKEN: '${{ secrets.GH_RELEASE_PAT }}',
    },
  });

  return {
    'runs-on': 'ubuntu-latest',
    steps,
  };
}

/**
 * Generate a changelog preview workflow for PRs
 */
export function generateChangelogPreviewWorkflow(): string {
  const workflow: Record<string, unknown> = {
    name: 'Changelog Preview',
    on: {
      pull_request: {
        types: ['opened', 'synchronize', 'reopened'],
      },
    },
    jobs: {
      preview: {
        'runs-on': 'ubuntu-latest',
        steps: [
          {
            uses: 'actions/checkout@v4',
            with: {
              'fetch-depth': 0,
            },
          },
          {
            uses: 'getsentry/craft@v2',
            with: {
              action: 'changelog-preview',
            },
            env: {
              GITHUB_TOKEN: '${{ secrets.GITHUB_TOKEN }}',
            },
          },
        ],
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

/**
 * Generate a publish workflow that runs after PR merge
 */
export function generatePublishWorkflow(context: TemplateContext): string {
  const steps: Record<string, unknown>[] = [];

  // Checkout
  steps.push({
    uses: 'actions/checkout@v4',
    with: {
      'fetch-depth': 0,
    },
  });

  // Node.js setup (if needed)
  if (context.nodeSetup) {
    if (context.nodeSetup.packageManager === 'pnpm') {
      steps.push({
        uses: 'pnpm/action-setup@v4',
      });
    }

    const nodeStep: Record<string, unknown> = {
      uses: 'actions/setup-node@v4',
      with: {
        cache: context.nodeSetup.packageManager,
        'registry-url': 'https://registry.npmjs.org',
      },
    };

    if (context.nodeSetup.versionFile) {
      nodeStep.with = {
        ...(nodeStep.with as Record<string, unknown>),
        'node-version-file': context.nodeSetup.versionFile,
      };
    }

    steps.push(nodeStep);
  }

  // Python setup (if needed)
  if (context.pythonSetup) {
    const pythonStep: Record<string, unknown> = {
      uses: 'actions/setup-python@v5',
    };

    if (context.pythonSetup.version) {
      pythonStep.with = {
        'python-version': context.pythonSetup.version,
      };
    }

    steps.push(pythonStep);
  }

  // Craft publish action
  const craftEnv: Record<string, string> = {
    GH_TOKEN: '${{ secrets.GH_RELEASE_PAT }}',
  };

  // Add target-specific secrets
  const hasNpm = context.targets.some(t => t.name === 'npm');
  const hasPypi = context.targets.some(t => t.name === 'pypi');
  const hasCrates = context.targets.some(t => t.name === 'crates');

  if (hasNpm) {
    craftEnv.NPM_TOKEN = '${{ secrets.NPM_TOKEN }}';
  }
  if (hasPypi) {
    craftEnv.TWINE_USERNAME = '__token__';
    craftEnv.TWINE_PASSWORD = '${{ secrets.PYPI_TOKEN }}';
  }
  if (hasCrates) {
    craftEnv.CRATES_IO_TOKEN = '${{ secrets.CRATES_IO_TOKEN }}';
  }

  steps.push({
    uses: 'getsentry/craft@v2',
    with: {
      action: 'publish',
    },
    env: craftEnv,
  });

  const workflow: Record<string, unknown> = {
    name: 'Publish',
    on: {
      push: {
        branches: ['master', 'main'],
        paths: ['CHANGELOG.md'],
      },
    },
    jobs: {
      publish: {
        'runs-on': 'ubuntu-latest',
        steps,
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
