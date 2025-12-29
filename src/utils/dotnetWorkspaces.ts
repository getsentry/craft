import { readFileSync } from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import { XMLParser } from 'fast-xml-parser';

import { logger } from '../logger';
import { WorkspacePackage, topologicalSortPackages } from './workspaces';

/**
 * Check if an error is a "file not found" error
 */
function isNotFoundError(err: unknown): boolean {
  return err instanceof Error && 'code' in err && err.code === 'ENOENT';
}

/** Information about a .NET project that produces a NuGet package */
export interface DotnetPackage {
  /** The NuGet package ID (from PackageId or project name) */
  packageId: string;
  /** Absolute path to the .csproj file */
  projectPath: string;
  /** Whether the project is packable (produces a .nupkg) */
  isPackable: boolean;
  /** Package IDs of other projects this project depends on */
  projectDependencies: string[];
}

/** Result of .NET workspace discovery */
export interface DotnetDiscoveryResult {
  /** List of discovered packages */
  packages: DotnetPackage[];
  /** Path to the solution file used */
  solutionPath: string;
}

/** Parsed .csproj PropertyGroup structure */
interface CsprojPropertyGroup {
  PackageId?: string;
  IsPackable?: boolean | string;
}

/** Parsed .csproj ItemGroup structure */
interface CsprojItemGroup {
  ProjectReference?:
    | Array<{ '@_Include': string }>
    | { '@_Include': string };
}

/** Parsed .csproj structure */
interface CsprojProject {
  Project?: {
    PropertyGroup?: CsprojPropertyGroup | CsprojPropertyGroup[];
    ItemGroup?: CsprojItemGroup | CsprojItemGroup[];
  };
}

/**
 * Parse a .sln file and extract all .csproj project paths.
 * Uses static regex parsing - no code execution.
 *
 * @param solutionPath Absolute path to the .sln file
 * @returns Array of absolute paths to .csproj files
 */
export function parseSolutionFile(solutionPath: string): string[] {
  let content: string;
  try {
    content = readFileSync(solutionPath, 'utf-8');
  } catch (err) {
    if (isNotFoundError(err)) {
      logger.warn(`Solution file not found: ${solutionPath}`);
      return [];
    }
    throw err;
  }

  const solutionDir = path.dirname(solutionPath);
  const projectPaths: string[] = [];

  // Match project entries in .sln file
  // Format: Project("{GUID}") = "ProjectName", "path\to\project.csproj", "{GUID}"
  const projectRegex =
    /Project\("\{[^}]+\}"\)\s*=\s*"[^"]*",\s*"([^"]+\.csproj)"/gi;

  let match;
  while ((match = projectRegex.exec(content)) !== null) {
    const relativePath = match[1];
    // Normalize path separators (Windows uses backslashes in .sln files)
    const normalizedPath = relativePath.replace(/\\/g, '/');
    const absolutePath = path.resolve(solutionDir, normalizedPath);
    projectPaths.push(absolutePath);
  }

  return projectPaths;
}

/**
 * Parse a .csproj file and extract package information.
 * Uses XML parsing - no code execution.
 *
 * @param projectPath Absolute path to the .csproj file
 * @returns DotnetPackage info or null if not found/parseable
 */
export function parseCsprojFile(projectPath: string): DotnetPackage | null {
  let content: string;
  try {
    content = readFileSync(projectPath, 'utf-8');
  } catch (err) {
    if (isNotFoundError(err)) {
      logger.warn(`Project file not found: ${projectPath}`);
      return null;
    }
    throw err;
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
  });

  let parsed: CsprojProject;
  try {
    parsed = parser.parse(content);
  } catch (err) {
    logger.warn(`Failed to parse csproj file ${projectPath}:`, err);
    return null;
  }

  const project = parsed.Project;
  if (!project) {
    logger.warn(`Invalid csproj structure in ${projectPath}: missing Project element`);
    return null;
  }

  // Extract PackageId and IsPackable from PropertyGroup(s)
  let packageId: string | undefined;
  let isPackable = true; // Default to true for SDK-style projects

  const propertyGroups = Array.isArray(project.PropertyGroup)
    ? project.PropertyGroup
    : project.PropertyGroup
      ? [project.PropertyGroup]
      : [];

  for (const pg of propertyGroups) {
    if (pg.PackageId && !packageId) {
      packageId = pg.PackageId;
    }
    if (pg.IsPackable !== undefined) {
      // IsPackable can be boolean or string "true"/"false"
      isPackable =
        pg.IsPackable === true ||
        pg.IsPackable === 'true' ||
        pg.IsPackable === 'True';
    }
  }

  // Use project filename (without extension) as fallback for PackageId
  if (!packageId) {
    packageId = path.basename(projectPath, '.csproj');
  }

  // Extract ProjectReference dependencies
  const projectDependencies: string[] = [];
  const itemGroups = Array.isArray(project.ItemGroup)
    ? project.ItemGroup
    : project.ItemGroup
      ? [project.ItemGroup]
      : [];

  for (const ig of itemGroups) {
    if (!ig.ProjectReference) continue;

    const refs = Array.isArray(ig.ProjectReference)
      ? ig.ProjectReference
      : [ig.ProjectReference];

    for (const ref of refs) {
      const includePath = ref['@_Include'];
      if (includePath) {
        // Normalize and extract the project name from the reference path
        const normalizedPath = includePath.replace(/\\/g, '/');
        const refProjectName = path.basename(normalizedPath, '.csproj');
        projectDependencies.push(refProjectName);
      }
    }
  }

  return {
    packageId,
    projectPath,
    isPackable,
    projectDependencies,
  };
}

/**
 * Find a .sln file in the given directory
 *
 * @param rootDir Directory to search in
 * @returns Path to the first .sln file found, or null
 */
export async function findSolutionFile(
  rootDir: string
): Promise<string | null> {
  const matches = await glob('*.sln', {
    cwd: rootDir,
    absolute: true,
  });

  if (matches.length === 0) {
    return null;
  }

  if (matches.length > 1) {
    logger.warn(
      `Multiple solution files found in ${rootDir}, using first one: ${matches[0]}`
    );
  }

  return matches[0];
}

/**
 * Discover all NuGet packages in a .NET solution.
 * Uses only static file parsing - no code execution.
 *
 * @param rootDir Root directory of the repository
 * @param solutionPath Optional path to .sln file (relative to rootDir or absolute)
 * @returns Discovery result with packages and solution path
 */
export async function discoverDotnetPackages(
  rootDir: string,
  solutionPath?: string
): Promise<DotnetDiscoveryResult | null> {
  // Resolve solution path
  let resolvedSolutionPath: string;
  if (solutionPath) {
    resolvedSolutionPath = path.isAbsolute(solutionPath)
      ? solutionPath
      : path.resolve(rootDir, solutionPath);
  } else {
    const found = await findSolutionFile(rootDir);
    if (!found) {
      logger.debug('No solution file found in root directory');
      return null;
    }
    resolvedSolutionPath = found;
  }

  logger.debug(`Using solution file: ${resolvedSolutionPath}`);

  // Parse solution file to get project paths
  const projectPaths = parseSolutionFile(resolvedSolutionPath);
  if (projectPaths.length === 0) {
    logger.warn('No projects found in solution file');
    return null;
  }

  logger.debug(`Found ${projectPaths.length} projects in solution`);

  // Parse each project file
  const packages: DotnetPackage[] = [];
  const packageIdSet = new Set<string>();

  for (const projectPath of projectPaths) {
    const pkg = parseCsprojFile(projectPath);
    if (pkg && pkg.isPackable) {
      packages.push(pkg);
      packageIdSet.add(pkg.packageId);
    }
  }

  // Filter projectDependencies to only include packages in our set
  // (convert project names to package IDs where possible)
  for (const pkg of packages) {
    pkg.projectDependencies = pkg.projectDependencies.filter(dep =>
      packageIdSet.has(dep)
    );
  }

  logger.debug(
    `Discovered ${packages.length} packable projects: ${packages.map(p => p.packageId).join(', ')}`
  );

  return {
    packages,
    solutionPath: resolvedSolutionPath,
  };
}

/**
 * Convert DotnetPackage array to WorkspacePackage array for use with
 * the generic topologicalSortPackages function.
 *
 * @param packages Array of DotnetPackage
 * @returns Array of WorkspacePackage
 */
export function dotnetPackagesToWorkspacePackages(
  packages: DotnetPackage[]
): WorkspacePackage[] {
  return packages.map(pkg => ({
    name: pkg.packageId,
    location: path.dirname(pkg.projectPath),
    private: !pkg.isPackable,
    hasPublicAccess: true, // NuGet packages are public by default
    workspaceDependencies: pkg.projectDependencies,
  }));
}

/**
 * Sort .NET packages topologically based on their project dependencies.
 * Packages with no dependencies come first.
 *
 * @param packages Array of DotnetPackage
 * @returns Sorted array of DotnetPackage
 */
export function sortDotnetPackages(packages: DotnetPackage[]): DotnetPackage[] {
  // Convert to WorkspacePackage, sort, then map back
  const workspacePackages = dotnetPackagesToWorkspacePackages(packages);
  const sorted = topologicalSortPackages(workspacePackages);

  // Create a map for O(1) lookup
  const packageMap = new Map(packages.map(p => [p.packageId, p]));

  // Return packages in sorted order
  return sorted
    .map(wp => packageMap.get(wp.name))
    .filter((p): p is DotnetPackage => p !== undefined);
}

/**
 * Convert a NuGet package ID to an artifact filename pattern.
 *
 * @param packageId The NuGet package ID (e.g., "Sentry.AspNetCore")
 * @returns A regex pattern string to match the artifact
 */
export function packageIdToNugetArtifactPattern(packageId: string): string {
  // NuGet package artifacts are named: {PackageId}.{Version}.nupkg
  // We need to escape dots in the package ID for the regex
  const escaped = packageId.replace(/\./g, '\\.');
  return `/^${escaped}\\.\\d.*\\.nupkg$/`;
}

/**
 * Convert a NuGet package ID to an artifact filename using a template.
 *
 * Template variables:
 * - {{packageId}}: The package ID (e.g., Sentry.AspNetCore)
 * - {{version}}: The version string
 *
 * @param packageId The NuGet package ID
 * @param template The artifact template string
 * @param version Optional version to substitute (defaults to regex pattern)
 * @returns The artifact filename pattern
 */
export function packageIdToNugetArtifactFromTemplate(
  packageId: string,
  template: string,
  version = '\\d.*'
): string {
  // Escape special regex characters
  const escapeRegex = (str: string): string =>
    str.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

  const PACKAGE_ID_PLACEHOLDER = '\x00PKGID\x00';
  const VERSION_PLACEHOLDER = '\x00VERSION\x00';

  // Replace template markers with placeholders
  let result = template
    .replace(/\{\{packageId\}\}/g, PACKAGE_ID_PLACEHOLDER)
    .replace(/\{\{version\}\}/g, VERSION_PLACEHOLDER);

  // Escape regex special characters in the template
  result = escapeRegex(result);

  // Replace placeholders with escaped values
  const versionValue = version === '\\d.*' ? version : escapeRegex(version);
  result = result
    .replace(new RegExp(escapeRegex(PACKAGE_ID_PLACEHOLDER), 'g'), escapeRegex(packageId))
    .replace(new RegExp(escapeRegex(VERSION_PLACEHOLDER), 'g'), versionValue);

  return `/^${result}$/`;
}
