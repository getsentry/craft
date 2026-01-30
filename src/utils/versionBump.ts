import { TargetConfig } from '../schemas/project_config';
import { TARGET_MAP } from '../targets';
import { logger } from '../logger';

/**
 * Interface for target classes that support automatic version bumping.
 * Targets implement this as a static method to bump version in project files.
 */
export interface VersionBumpableTarget {
  /**
   * Bump version in project files for this target's ecosystem.
   *
   * @param rootDir - Project root directory
   * @param newVersion - New version string to set
   * @returns true if version was bumped, false if target doesn't apply to this project
   * @throws Error if bumping fails (missing tool, command error, file write error, etc.)
   */
  bumpVersion(rootDir: string, newVersion: string): Promise<boolean>;
}

/**
 * Check if a target class has the bumpVersion static method
 */
function hasVersionBump(
  targetClass: unknown,
): targetClass is { bumpVersion: VersionBumpableTarget['bumpVersion'] } {
  return (
    typeof targetClass === 'function' &&
    'bumpVersion' in targetClass &&
    typeof (targetClass as any).bumpVersion === 'function'
  );
}

/**
 * Result of running automatic version bumps
 */
export interface VersionBumpResult {
  /** Whether at least one target successfully bumped the version */
  anyBumped: boolean;
  /** Targets that support version bumping (have bumpVersion method) */
  bumpableTargets: string[];
  /** Targets that support bumping but didn't apply (e.g., no matching files) */
  skippedTargets: string[];
}

/**
 * Run automatic version bumps for all applicable targets.
 * Calls bumpVersion() on each unique target class in config order.
 *
 * @param targets - Target configs from .craft.yml
 * @param rootDir - Project root directory
 * @param newVersion - New version to set
 * @returns Result with bump status and target details
 * @throws Error if any bumpVersion() call throws
 */
export async function runAutomaticVersionBumps(
  targets: TargetConfig[],
  rootDir: string,
  newVersion: string,
): Promise<VersionBumpResult> {
  // Deduplicate: multiple npm targets should only bump package.json once
  const processedTargetTypes = new Set<string>();
  let anyBumped = false;
  const bumpableTargets: string[] = [];
  const skippedTargets: string[] = [];

  for (const targetConfig of targets) {
    const targetName = targetConfig.name;

    // Skip if we've already processed this target type
    if (processedTargetTypes.has(targetName)) {
      continue;
    }
    processedTargetTypes.add(targetName);

    const targetClass = TARGET_MAP[targetName];
    if (!targetClass) {
      logger.debug(`Unknown target "${targetName}", skipping version bump`);
      continue;
    }

    if (!hasVersionBump(targetClass)) {
      logger.debug(
        `Target "${targetName}" does not support automatic version bumping`,
      );
      continue;
    }

    bumpableTargets.push(targetName);
    logger.debug(`Running version bump for target "${targetName}"...`);

    try {
      const bumped = await targetClass.bumpVersion(rootDir, newVersion);
      if (bumped) {
        logger.info(`Version bumped by "${targetName}" target`);
        anyBumped = true;
      } else {
        logger.debug(`Target "${targetName}" did not apply (detection failed)`);
        skippedTargets.push(targetName);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Automatic version bump failed for "${targetName}" target: ${message}`,
      );
    }
  }

  return { anyBumped, bumpableTargets, skippedTargets };
}
