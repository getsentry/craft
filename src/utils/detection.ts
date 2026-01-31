import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { TargetConfig } from '../schemas/project_config';

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
 * Priority constants for target ordering in generated configs.
 * Lower numbers appear first in the config file.
 */
export const TargetPriority = {
  // Package registries - appear first
  NPM: 10,
  PYPI: 20,
  CRATES: 30,
  GEM: 40,
  NUGET: 50,
  PUB_DEV: 60,
  HEX: 70,
  MAVEN: 80,
  COCOAPODS: 90,

  // Storage and distribution
  GCS: 100,
  DOCKER: 110,
  AWS_LAMBDA: 120,
  POWERSHELL: 130,

  // Metadata and registry
  REGISTRY: 200,
  BREW: 210,
  SYMBOL_COLLECTOR: 220,
  GH_PAGES: 230,

  // Should always be last
  GITHUB: 900,
} as const;
