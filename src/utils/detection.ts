import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { load } from 'js-yaml';
import { TargetConfig } from '../schemas/project_config';

/**
 * GitHub Action manifest structure (partial, only what we need)
 */
interface ActionManifest {
  runs?: {
    using?: string;
    main?: string;
  };
}

/**
 * Context for target detection, providing information about the project
 * that targets can use to determine if they apply.
 */
export interface DetectionContext {
  /** Root directory of the project */
  rootDir: string;
  /** GitHub owner (if detected) */
  githubOwner?: string;
  /** GitHub repo name (if detected) */
  githubRepo?: string;
}

/**
 * Information about a required secret for a target
 */
export interface RequiredSecret {
  /** Environment variable name (e.g., 'NPM_TOKEN') */
  name: string;
  /** Human-readable description */
  description: string;
}

/**
 * Workflow setup information detected from the project.
 * Used to generate appropriate GitHub Actions workflows.
 */
export interface WorkflowSetup {
  /** Node.js setup (if applicable) */
  node?: {
    /** Package manager to use */
    packageManager: 'npm' | 'pnpm' | 'yarn';
    /** Node version file path (e.g., .nvmrc, package.json for volta) */
    versionFile?: string;
  };
  /** Python setup (if applicable) */
  python?: {
    /** Python version */
    version?: string;
  };
}

/**
 * Result of target detection, including the config and a priority for ordering.
 * Higher priority targets appear later in the generated config (e.g., github should be last).
 */
export interface DetectionResult {
  /** The detected target configuration */
  config: TargetConfig;
  /**
   * Priority for ordering in the config file.
   * Lower numbers appear first. Use these guidelines:
   * - 0-99: Package registries (npm, pypi, crates, etc.)
   * - 100-199: Storage/CDN targets (gcs, docker, etc.)
   * - 200-299: Registry/metadata targets
   * - 900-999: GitHub and other "final" targets
   */
  priority: number;
  /**
   * Workflow setup information for this target.
   * Used to generate appropriate GitHub Actions workflows.
   */
  workflowSetup?: WorkflowSetup;
  /**
   * Secrets required by this target for publishing.
   */
  requiredSecrets?: RequiredSecret[];
}

/**
 * Check if a file exists in the given directory
 */
export function fileExists(
  rootDir: string,
  ...pathSegments: string[]
): boolean {
  return existsSync(path.join(rootDir, ...pathSegments));
}

/**
 * Read a JSON file from the project directory
 */
export function readJsonFile<T = unknown>(
  rootDir: string,
  ...pathSegments: string[]
): T | null {
  const filePath = path.join(rootDir, ...pathSegments);
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Read a file as text from the project directory
 */
export function readTextFile(
  rootDir: string,
  ...pathSegments: string[]
): string | null {
  const filePath = path.join(rootDir, ...pathSegments);
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Detect if a project is a compiled GitHub Action.
 *
 * A compiled GitHub Action is identified by:
 * 1. Has `action.yml` or `action.yaml` at the root
 * 2. The `runs.using` field starts with `node` (e.g., `node20`, `node16`, `node12`)
 * 3. The `runs.main` field references a path in `dist/` (e.g., `dist/index.js`)
 *
 * These actions typically have their `dist/` folder gitignored on main/master
 * but need it in release branches for the action to work. Merging the release
 * branch back would overwrite the clean main branch with compiled artifacts.
 *
 * @param rootDir The root directory of the project
 * @returns true if the project is a compiled GitHub Action
 */
export function isCompiledGitHubAction(rootDir: string): boolean {
  // Check for action.yml or action.yaml (action.yml takes precedence)
  // Use ?? instead of || so empty files are still respected as "existing"
  const actionContent =
    readTextFile(rootDir, 'action.yml') ?? readTextFile(rootDir, 'action.yaml');

  if (!actionContent) {
    return false;
  }

  try {
    const manifest = load(actionContent) as ActionManifest;

    // Check if it's a Node.js action
    const using = manifest?.runs?.using;
    if (!using || !using.startsWith('node')) {
      return false;
    }

    // Check if main references dist/
    const main = manifest?.runs?.main;
    if (!main) {
      return false;
    }

    // Check if main path starts with 'dist/' (after removing optional './' prefix)
    // Common patterns: 'dist/index.js', './dist/index.js', 'dist/main.js'
    // We only check for root-level dist/ since that's the standard for compiled actions
    const normalizedMain = main.replace(/^\.\//, '');
    return normalizedMain.startsWith('dist/');
  } catch {
    // If we can't parse the YAML, assume it's not a compiled action
    return false;
  }
}

/**
 * Recommended priority values for target ordering in generated configs.
 * Lower numbers appear first in the config file.
 *
 * Each target should define its own `static readonly priority` property.
 *
 * Guidelines:
 * - 0-99: Package registries (npm=10, pypi=20, crates=30, gem=40, nuget=50, pub-dev=60, hex=70, maven=80, cocoapods=90)
 * - 100-199: Storage/CDN targets (gcs=100, docker=110, aws-lambda=120, powershell=130)
 * - 200-299: Registry/metadata targets (registry=200, brew=210, symbol-collector=220, gh-pages=230)
 * - 900-999: GitHub and other "final" targets (github=900)
 */
