import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { load } from 'js-yaml';

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
 * Read a file as text from the project directory
 */
function readTextFile(
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
