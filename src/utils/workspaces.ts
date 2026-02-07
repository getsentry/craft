import { readFileSync } from 'fs';
import * as path from 'path';
import { load } from 'js-yaml';
import { glob } from 'glob';

import { logger } from '../logger';

/**
 * Check if an error is a "file not found" error
 */
function isNotFoundError(err: unknown): boolean {
  return err instanceof Error && 'code' in err && err.code === 'ENOENT';
}

/** Information about a workspace package */
export interface WorkspacePackage {
  /** The package name from package.json */
  name: string;
  /** Absolute path to the package directory */
  location: string;
  /** Whether the package is private */
  private: boolean;
  /** Whether the package has publishConfig.access set to 'public' */
  hasPublicAccess: boolean;
  /** Dependencies that are also workspace packages */
  workspaceDependencies: string[];
}

/** Result of workspace discovery */
export interface WorkspaceDiscoveryResult {
  /** The type of workspace manager detected */
  type: 'npm' | 'yarn' | 'pnpm' | 'none';
  /** List of discovered packages */
  packages: WorkspacePackage[];
}

/** Structure of pnpm-workspace.yaml */
interface PnpmWorkspaceConfig {
  packages?: string[];
}

/** Parsed package.json structure */
interface PackageJson {
  name?: string;
  workspaces?: string[] | { packages?: string[] };
  private?: boolean;
  publishConfig?: {
    access?: 'public' | 'restricted';
  };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

/**
 * Read and parse a package.json file
 */
function readPackageJson(packagePath: string): PackageJson | null {
  const packageJsonPath = path.join(packagePath, 'package.json');
  try {
    return JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
  } catch (err) {
    if (!isNotFoundError(err)) {
      logger.warn(`Failed to parse ${packageJsonPath}:`, err);
    }
    return null;
  }
}

/**
 * Get all dependency names from a package.json
 * Includes dependencies, peerDependencies, and optionalDependencies
 * (not devDependencies as those don't need to be published first)
 */
function getAllDependencyNames(packageJson: PackageJson): string[] {
  const deps = new Set<string>();

  for (const dep of Object.keys(packageJson.dependencies || {})) {
    deps.add(dep);
  }
  for (const dep of Object.keys(packageJson.peerDependencies || {})) {
    deps.add(dep);
  }
  for (const dep of Object.keys(packageJson.optionalDependencies || {})) {
    deps.add(dep);
  }

  return Array.from(deps);
}

/**
 * Extract workspaces array from package.json workspaces field
 * Handles both array format and object format with packages property
 */
function extractWorkspacesGlobs(
  workspaces: string[] | { packages?: string[] } | undefined,
): string[] {
  if (!workspaces) {
    return [];
  }
  if (Array.isArray(workspaces)) {
    return workspaces;
  }
  return workspaces.packages || [];
}

/**
 * Resolve glob patterns to actual package directories
 */
async function resolveWorkspaceGlobs(
  rootDir: string,
  patterns: string[],
): Promise<WorkspacePackage[]> {
  // First: collect all workspace package names and locations
  const workspaceLocations: Array<{
    location: string;
    packageJson: PackageJson;
  }> = [];
  const workspaceNames = new Set<string>();

  for (const pattern of patterns) {
    const matches = await glob(pattern, {
      cwd: rootDir,
      absolute: true,
      ignore: ['**/node_modules/**'],
    });

    for (const match of matches) {
      const packageJson = readPackageJson(match);
      if (packageJson?.name) {
        workspaceLocations.push({ location: match, packageJson });
        workspaceNames.add(packageJson.name);
      }
    }
  }

  // Now resolve dependencies in a single pass, filtering against known workspace names
  return workspaceLocations.map(({ location, packageJson }) => ({
    name: packageJson.name as string,
    location,
    private: packageJson.private ?? false,
    hasPublicAccess: packageJson.publishConfig?.access === 'public',
    workspaceDependencies: getAllDependencyNames(packageJson).filter(dep =>
      workspaceNames.has(dep),
    ),
  }));
}

/**
 * Check if a file exists by trying to read it
 */
function fileExists(filePath: string): boolean {
  try {
    readFileSync(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Discover npm/yarn workspaces from package.json
 */
async function discoverNpmYarnWorkspaces(
  rootDir: string,
): Promise<WorkspaceDiscoveryResult | null> {
  const packageJson = readPackageJson(rootDir);
  if (!packageJson) {
    return null;
  }

  const workspacesGlobs = extractWorkspacesGlobs(packageJson.workspaces);
  if (workspacesGlobs.length === 0) {
    return null;
  }

  // Detect if it's yarn or npm based on lock files
  const type = fileExists(path.join(rootDir, 'yarn.lock')) ? 'yarn' : 'npm';

  const packages = await resolveWorkspaceGlobs(rootDir, workspacesGlobs);

  logger.debug(
    `Discovered ${
      packages.length
    } ${type} workspace packages from ${workspacesGlobs.join(', ')}`,
  );

  return { type, packages };
}

/**
 * Discover pnpm workspaces from pnpm-workspace.yaml
 */
async function discoverPnpmWorkspaces(
  rootDir: string,
): Promise<WorkspaceDiscoveryResult | null> {
  const pnpmWorkspacePath = path.join(rootDir, 'pnpm-workspace.yaml');

  let config: PnpmWorkspaceConfig;
  try {
    const content = readFileSync(pnpmWorkspacePath, 'utf-8');
    config = load(content) as PnpmWorkspaceConfig;
  } catch (err) {
    if (!isNotFoundError(err)) {
      logger.warn(`Failed to parse ${pnpmWorkspacePath}:`, err);
    }
    return null;
  }

  const patterns = config.packages || [];
  if (patterns.length === 0) {
    return null;
  }

  const packages = await resolveWorkspaceGlobs(rootDir, patterns);

  logger.debug(
    `Discovered ${packages.length} pnpm workspace packages from ${patterns.join(
      ', ',
    )}`,
  );

  return { type: 'pnpm', packages };
}

/**
 * Discover all workspace packages in a monorepo
 *
 * Supports:
 * - npm workspaces (package.json "workspaces" field)
 * - yarn workspaces (package.json "workspaces" field)
 * - pnpm workspaces (pnpm-workspace.yaml)
 *
 * @param rootDir Root directory of the monorepo
 * @returns Discovery result with type and packages, or null if not a workspace
 */
export async function discoverWorkspaces(
  rootDir: string,
): Promise<WorkspaceDiscoveryResult> {
  // Try pnpm first (more specific)
  const pnpmResult = await discoverPnpmWorkspaces(rootDir);
  if (pnpmResult) {
    return pnpmResult;
  }

  // Try npm/yarn workspaces
  const npmYarnResult = await discoverNpmYarnWorkspaces(rootDir);
  if (npmYarnResult) {
    return npmYarnResult;
  }

  // No workspaces found
  return { type: 'none', packages: [] };
}

/**
 * Convert a package name to an artifact filename pattern
 *
 * Default convention:
 * - @sentry/browser -> sentry-browser-\d.*\.tgz
 * - @sentry-internal/browser-utils -> sentry-internal-browser-utils-\d.*\.tgz
 *
 * @param packageName The npm package name
 * @returns A regex pattern string to match the artifact
 */
export function packageNameToArtifactPattern(packageName: string): string {
  // Remove @ prefix, replace / with -
  const normalized = packageName.replace(/^@/, '').replace(/\//g, '-');
  // Create a regex pattern that matches the artifact filename
  return `/^${normalized}-\\d.*\\.tgz$/`;
}

/**
 * Escape special regex characters in a string.
 * Only escapes characters that have special meaning in regex.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/**
 * Convert a package name to an artifact filename using a template
 *
 * Template variables:
 * - {{name}}: The package name (e.g., @sentry/browser)
 * - {{simpleName}}: Simplified name (e.g., sentry-browser)
 * - {{version}}: The version string
 *
 * @param packageName The npm package name
 * @param template The artifact template string
 * @param version Optional version to substitute
 * @returns The artifact filename pattern
 */
export function packageNameToArtifactFromTemplate(
  packageName: string,
  template: string,
  version = '\\d.*',
): string {
  const simpleName = packageName.replace(/^@/, '').replace(/\//g, '-');

  // Use placeholders to preserve template markers during escaping
  const NAME_PLACEHOLDER = '\x00NAME\x00';
  const SIMPLE_PLACEHOLDER = '\x00SIMPLE\x00';
  const VERSION_PLACEHOLDER = '\x00VERSION\x00';

  // Replace template markers with placeholders
  let result = template
    .replace(/\{\{name\}\}/g, NAME_PLACEHOLDER)
    .replace(/\{\{simpleName\}\}/g, SIMPLE_PLACEHOLDER)
    .replace(/\{\{version\}\}/g, VERSION_PLACEHOLDER);

  // Escape regex special characters in the template
  result = escapeRegex(result);

  // Replace placeholders with escaped values (or regex pattern for version)
  // If version is the default regex pattern, use it as-is; otherwise escape it
  const versionValue = version === '\\d.*' ? version : escapeRegex(version);
  result = result
    .replace(
      new RegExp(escapeRegex(NAME_PLACEHOLDER), 'g'),
      escapeRegex(packageName),
    )
    .replace(
      new RegExp(escapeRegex(SIMPLE_PLACEHOLDER), 'g'),
      escapeRegex(simpleName),
    )
    .replace(new RegExp(escapeRegex(VERSION_PLACEHOLDER), 'g'), versionValue);

  return `/^${result}$/`;
}

/**
 * Filter workspace packages based on include/exclude patterns
 *
 * @param packages List of workspace packages
 * @param includePattern Optional regex pattern to include packages
 * @param excludePattern Optional regex pattern to exclude packages
 * @returns Filtered list of packages
 */
export function filterWorkspacePackages(
  packages: WorkspacePackage[],
  includePattern?: RegExp,
  excludePattern?: RegExp,
): WorkspacePackage[] {
  return packages.filter(pkg => {
    // Check exclude pattern first
    if (excludePattern && excludePattern.test(pkg.name)) {
      return false;
    }
    // Check include pattern
    if (includePattern && !includePattern.test(pkg.name)) {
      return false;
    }
    return true;
  });
}

/**
 * Topologically sort workspace packages based on their dependencies.
 * Packages with no dependencies come first, then packages that depend on them, etc.
 *
 * Computes depth for each package (depth = 1 + max depth of dependencies)
 * and sorts by depth ascending.
 *
 * @param packages List of workspace packages
 * @returns Sorted list of packages (dependencies before dependents)
 * @throws Error if there's a circular dependency
 */
export function topologicalSortPackages(
  packages: WorkspacePackage[],
): WorkspacePackage[] {
  // Map package name to its workspace dependencies
  const depsMap = new Map<string, string[]>();
  for (const pkg of packages) {
    depsMap.set(pkg.name, pkg.workspaceDependencies);
  }

  // Compute depth for each package using memoization
  // Depth = 1 + max(depth of dependencies), or 0 if no dependencies
  const depths = new Map<string, number>();
  const computing = new Set<string>(); // Tracks recursion stack for cycle detection

  function computeDepth(name: string): number {
    const cached = depths.get(name);
    if (cached !== undefined) {
      return cached;
    }

    if (computing.has(name)) {
      const cyclePackages = Array.from(computing);
      throw new Error(
        `Circular dependency detected among workspace packages: ${cyclePackages.join(', ')}`,
      );
    }

    computing.add(name);

    let maxDepDepth = -1;
    for (const dep of depsMap.get(name) || []) {
      // Only consider dependencies that are in our package list
      if (depsMap.has(dep)) {
        maxDepDepth = Math.max(maxDepDepth, computeDepth(dep));
      }
    }

    computing.delete(name);

    const depth = maxDepDepth + 1;
    depths.set(name, depth);
    return depth;
  }

  // Compute depths for all packages
  for (const name of depsMap.keys()) {
    computeDepth(name);
  }

  // Sort by depth (packages with lower depth come first)
  return [...packages].sort((a, b) => {
    const depthA = depths.get(a.name) ?? 0;
    const depthB = depths.get(b.name) ?? 0;
    return depthA - depthB;
  });
}
