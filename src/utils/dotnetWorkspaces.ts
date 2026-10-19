import { existsSync, readFileSync } from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import { XMLParser } from 'fast-xml-parser';

import { logger } from '../logger';
import {
  WorkspacePackage,
  topologicalSortPackages,
  escapeRegex,
} from './workspaces';

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

/**
 * A parsed MSBuild property value. Elements with attributes (e.g. a
 * `Condition`) are parsed into objects rather than plain scalars.
 */
type MsbuildValue =
  | string
  | number
  | boolean
  | { '#text'?: string | number | boolean; '@_Condition'?: string };

/** Parsed MSBuild PropertyGroup structure */
interface MsbuildPropertyGroup {
  '@_Condition'?: string;
  PackageId?: MsbuildValue;
  IsPackable?: MsbuildValue;
}

/** Parsed MSBuild ItemGroup structure */
interface MsbuildItemGroup {
  ProjectReference?: Array<{ '@_Include'?: string }>;
}

/** Parsed MSBuild project file (.csproj, Directory.Build.props, ...) */
interface MsbuildProject {
  Project?: {
    PropertyGroup?: MsbuildPropertyGroup[];
    ItemGroup?: MsbuildItemGroup[];
    Import?: Array<{ '@_Project'?: string; '@_Condition'?: string }>;
  };
}

/** A parsed .slnx Folder or Solution node; both may contain projects */
interface SlnxContainer {
  Project?: Array<{ '@_Path'?: string }>;
  Folder?: SlnxContainer[];
}

/** Parsed .slnx structure */
interface SlnxSolution {
  Solution?: SlnxContainer;
}

/** Name of the MSBuild file the .NET SDK auto-imports into every project */
const DIRECTORY_BUILD_PROPS = 'Directory.Build.props';

/** Properties craft reads from MSBuild files */
interface MsbuildProperties {
  packageId?: string;
  isPackable?: boolean;
}

/** Elements that may repeat, so the parser always yields arrays for them */
const MSBUILD_ARRAY_TAGS = new Set([
  'PropertyGroup',
  'ItemGroup',
  'ProjectReference',
  'Import',
]);
const SLNX_ARRAY_TAGS = new Set(['Project', 'Folder']);

function createXmlParser(arrayTags: Set<string>): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    isArray: name => arrayTags.has(name),
  });
}

/**
 * Returns the unconditional scalar value of an MSBuild property, or
 * `undefined` if it is conditional, empty, or depends on other properties.
 * Craft does not evaluate MSBuild, so only static values are trusted.
 */
function staticPropertyValue(
  value: MsbuildValue | undefined,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === 'object') {
    // Element has attributes; a Condition means the value is not static.
    if (value['@_Condition'] !== undefined || value['#text'] === undefined) {
      return undefined;
    }
    value = value['#text'];
  }
  const str = String(value).trim();
  if (!str || str.includes('$(')) {
    return undefined;
  }
  return str;
}

/**
 * Collects static `PackageId` / `IsPackable` values from the unconditional
 * property groups of a parsed MSBuild project. Later values win, matching
 * MSBuild's evaluation order.
 */
function readMsbuildProperties(
  project: NonNullable<MsbuildProject['Project']>,
  into: MsbuildProperties = {},
): MsbuildProperties {
  for (const pg of project.PropertyGroup ?? []) {
    if (pg['@_Condition'] !== undefined) {
      continue;
    }
    const packageId = staticPropertyValue(pg.PackageId);
    if (packageId) {
      into.packageId = packageId;
    }
    const isPackable = staticPropertyValue(pg.IsPackable);
    if (isPackable !== undefined) {
      into.isPackable = isPackable.toLowerCase() === 'true';
    }
  }
  return into;
}

/** Reads and parses an MSBuild file, returning its Project element */
function readMsbuildFile(
  filePath: string,
): NonNullable<MsbuildProject['Project']> | null {
  let parsed: MsbuildProject;
  try {
    parsed = createXmlParser(MSBUILD_ARRAY_TAGS).parse(
      readFileSync(filePath, 'utf-8'),
    );
  } catch (err) {
    if (!isNotFoundError(err)) {
      logger.warn(`Failed to parse ${filePath}:`, err);
    }
    return null;
  }
  return parsed.Project ?? null;
}

/**
 * Resolves the `<Import Project="..." />` paths of an MSBuild file that can
 * be determined statically (no `$(...)` properties) and exist on disk.
 */
function staticImportPaths(
  project: NonNullable<MsbuildProject['Project']>,
  filePath: string,
  { includeConditional }: { includeConditional: boolean },
): string[] {
  const result: string[] = [];
  for (const imp of project.Import ?? []) {
    const importPath = imp['@_Project'];
    if (
      !importPath ||
      importPath.includes('$(') ||
      (!includeConditional && imp['@_Condition'] !== undefined)
    ) {
      continue;
    }
    const resolved = path.resolve(
      path.dirname(filePath),
      importPath.replace(/\\/g, '/'),
    );
    if (/\.(props|targets)$/.test(resolved) && existsSync(resolved)) {
      result.push(resolved);
    }
  }
  return result;
}

/**
 * Evaluates a props file (e.g. Directory.Build.props) for the properties
 * craft cares about, following unconditional static imports so that a
 * nested Directory.Build.props importing its parent is handled.
 */
function evaluatePropsFile(
  propsPath: string,
  into: MsbuildProperties,
  visited: Set<string>,
): void {
  if (visited.has(propsPath)) {
    return;
  }
  visited.add(propsPath);

  const project = readMsbuildFile(propsPath);
  if (!project) {
    return;
  }
  // Imports normally precede property groups, so evaluate them first.
  for (const importPath of staticImportPaths(project, propsPath, {
    includeConditional: false,
  })) {
    evaluatePropsFile(importPath, into, visited);
  }
  readMsbuildProperties(project, into);
}

/**
 * Collects the names of all projects referenced via `<ProjectReference>`,
 * including references in statically imported files. Conditions are
 * ignored on purpose: a reference that only applies to some target
 * frameworks (e.g. Android bindings) is still a NuGet dependency that must
 * be published first.
 */
function collectProjectReferences(
  project: NonNullable<MsbuildProject['Project']>,
  filePath: string,
  into: Set<string>,
  visited: Set<string>,
): void {
  visited.add(filePath);
  for (const ig of project.ItemGroup ?? []) {
    for (const ref of ig.ProjectReference ?? []) {
      const includePath = ref['@_Include'];
      if (includePath) {
        const normalizedPath = includePath.replace(/\\/g, '/');
        into.add(path.basename(normalizedPath, '.csproj'));
      }
    }
  }
  for (const importPath of staticImportPaths(project, filePath, {
    includeConditional: true,
  })) {
    if (visited.has(importPath)) {
      continue;
    }
    const imported = readMsbuildFile(importPath);
    if (imported) {
      collectProjectReferences(imported, importPath, into, visited);
    }
  }
}

/**
 * Finds the Directory.Build.props the .NET SDK would auto-import for a
 * project: the nearest one walking up from the project directory, without
 * leaving `rootDir`.
 */
function findDirectoryBuildProps(
  projectPath: string,
  rootDir: string,
): string | null {
  const root = path.resolve(rootDir);
  let dir = path.dirname(path.resolve(projectPath));
  for (;;) {
    const candidate = path.join(dir, DIRECTORY_BUILD_PROPS);
    if (existsSync(candidate)) {
      return candidate;
    }
    if (dir === root) {
      return null;
    }
    const parent = path.dirname(dir);
    if (parent === dir || !parent.startsWith(root)) {
      return null;
    }
    dir = parent;
  }
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
 * Parse a .slnx (XML-based solution) file and extract all .csproj project paths.
 * Uses XML parsing - no code execution.
 *
 * @param solutionPath Absolute path to the .slnx file
 * @returns Array of absolute paths to .csproj files
 */
export function parseSlnxFile(solutionPath: string): string[] {
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

  let parsed: SlnxSolution;
  try {
    parsed = createXmlParser(SLNX_ARRAY_TAGS).parse(content);
  } catch (err) {
    logger.warn(`Failed to parse slnx file ${solutionPath}:`, err);
    return [];
  }

  const solution = parsed.Solution;
  if (!solution) {
    logger.warn(
      `Invalid slnx structure in ${solutionPath}: missing Solution element`,
    );
    return [];
  }

  const solutionDir = path.dirname(solutionPath);
  const projectPaths: string[] = [];

  // Projects can live at the top level or inside (nested) Folder elements.
  const collect = (container: SlnxContainer): void => {
    for (const project of container.Project ?? []) {
      const projectPath = project['@_Path'];
      if (projectPath && projectPath.endsWith('.csproj')) {
        const normalizedPath = projectPath.replace(/\\/g, '/');
        projectPaths.push(path.resolve(solutionDir, normalizedPath));
      }
    }
    for (const folder of container.Folder ?? []) {
      collect(folder);
    }
  };
  collect(solution);

  return projectPaths;
}

/**
 * Parse a .csproj file and extract package information.
 * Uses XML parsing - no code execution.
 *
 * When `rootDir` is given, `PackageId` and `IsPackable` defaults are also
 * read from the Directory.Build.props the .NET SDK would import for the
 * project (and any props files it statically imports), since repos commonly
 * set `IsPackable` there for whole directories such as `test/`.
 *
 * @param projectPath Absolute path to the .csproj file
 * @param rootDir Optional repository root bounding the Directory.Build.props lookup
 * @returns DotnetPackage info or null if not found/parseable
 */
export function parseCsprojFile(
  projectPath: string,
  rootDir?: string,
): DotnetPackage | null {
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

  let parsed: MsbuildProject;
  try {
    parsed = createXmlParser(MSBUILD_ARRAY_TAGS).parse(content);
  } catch (err) {
    logger.warn(`Failed to parse csproj file ${projectPath}:`, err);
    return null;
  }

  const project = parsed.Project;
  if (!project) {
    logger.warn(
      `Invalid csproj structure in ${projectPath}: missing Project element`,
    );
    return null;
  }

  // Directory.Build.props is imported before the project body, so the
  // project's own properties override it.
  const properties: MsbuildProperties = {};
  if (rootDir) {
    const propsPath = findDirectoryBuildProps(projectPath, rootDir);
    if (propsPath) {
      evaluatePropsFile(propsPath, properties, new Set());
    }
  }
  readMsbuildProperties(project, properties);

  const packageId =
    properties.packageId ?? path.basename(projectPath, '.csproj');
  // SDK-style projects are packable unless stated otherwise
  const isPackable = properties.isPackable ?? true;

  const references = new Set<string>();
  collectProjectReferences(project, projectPath, references, new Set());
  const projectDependencies = [...references];

  return {
    packageId,
    projectPath,
    isPackable,
    projectDependencies,
  };
}

/**
 * Find a solution file (.sln or .slnx) in the given directory.
 * Prefers .slnx over .sln if both exist.
 *
 * @param rootDir Directory to search in
 * @returns Path to the solution file found, or null
 */
export async function findSolutionFile(
  rootDir: string,
): Promise<string | null> {
  // Check for .slnx first (newer XML format)
  const slnxMatches = await glob('*.slnx', {
    cwd: rootDir,
    absolute: true,
  });

  if (slnxMatches.length > 0) {
    if (slnxMatches.length > 1) {
      logger.warn(
        `Multiple .slnx files found in ${rootDir}, using first one: ${slnxMatches[0]}`,
      );
    }
    return slnxMatches[0];
  }

  // Fall back to .sln
  const slnMatches = await glob('*.sln', {
    cwd: rootDir,
    absolute: true,
  });

  if (slnMatches.length === 0) {
    return null;
  }

  if (slnMatches.length > 1) {
    logger.warn(
      `Multiple .sln files found in ${rootDir}, using first one: ${slnMatches[0]}`,
    );
  }

  return slnMatches[0];
}

/**
 * Discover all NuGet packages in a .NET solution.
 * Supports both .sln and .slnx solution formats.
 * Uses only static file parsing - no code execution.
 *
 * @param rootDir Root directory of the repository
 * @param solutionPath Optional path to solution file (relative to rootDir or absolute)
 * @returns Discovery result with packages and solution path
 */
export async function discoverDotnetPackages(
  rootDir: string,
  solutionPath?: string,
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

  // Parse solution file to get project paths (use appropriate parser based on extension)
  const projectPaths = resolvedSolutionPath.endsWith('.slnx')
    ? parseSlnxFile(resolvedSolutionPath)
    : parseSolutionFile(resolvedSolutionPath);
  if (projectPaths.length === 0) {
    logger.warn('No projects found in solution file');
    return null;
  }

  logger.debug(`Found ${projectPaths.length} projects in solution`);

  // Parse each project file
  const packages: DotnetPackage[] = [];
  // ProjectReference points at project files, whose name may differ from
  // the PackageId, so map project names to package IDs.
  const projectNameToPackageId = new Map<string, string>();

  for (const projectPath of projectPaths) {
    const pkg = parseCsprojFile(projectPath, rootDir);
    if (pkg && pkg.isPackable) {
      packages.push(pkg);
      projectNameToPackageId.set(
        path.basename(projectPath, '.csproj'),
        pkg.packageId,
      );
    }
  }

  // Only keep dependencies on other packable projects in the solution
  for (const pkg of packages) {
    pkg.projectDependencies = pkg.projectDependencies
      .map(dep => projectNameToPackageId.get(dep))
      .filter((dep): dep is string => dep !== undefined);
  }

  logger.debug(
    `Discovered ${packages.length} packable projects: ${packages.map(p => p.packageId).join(', ')}`,
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
  packages: DotnetPackage[],
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
 * Matches both .nupkg (package) and .snupkg (symbols) files.
 *
 * @param packageId The NuGet package ID (e.g., "Sentry.AspNetCore")
 * @returns A regex pattern string to match the artifact
 */
export function packageIdToNugetArtifactPattern(packageId: string): string {
  // NuGet package artifacts are named: {PackageId}.{Version}.nupkg
  // Symbol packages are named: {PackageId}.{Version}.snupkg
  const escaped = escapeRegex(packageId);
  return `/^${escaped}\\.\\d.*\\.s?nupkg$/`;
}
