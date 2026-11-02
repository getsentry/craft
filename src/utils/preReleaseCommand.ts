import { join } from 'path';
import * as shellQuote from 'shell-quote';

import { requiresMinVersion } from '../config';
import { logger } from '../logger';
import {
  type TargetConfig,
  type VersionFileConfig,
} from '../schemas/project_config';
import { ConfigurationError } from './errors';
import { buildReleaseCommandEnv } from './releaseCommandEnv';
import { spawnProcess } from './system';
import { runAutomaticVersionBumps } from './versionBump';
import { updateVersionFiles } from './versionFiles';

/** Default path to bump-version script, relative to project root */
const DEFAULT_BUMP_VERSION_PATH = join('scripts', 'bump-version.sh');

/** Minimum craft version required for automatic version bumping from targets */
const AUTO_BUMP_MIN_VERSION = '2.21.0';

interface PreReleaseOptions {
  oldVersion: string;
  newVersion: string;
  preReleaseCommand?: string;
  targets?: TargetConfig[];
  /** Release unit directory that target bumps run in */
  rootDir: string;
  /** Extra files from `versioning.files`, relative to `repoRoot` */
  versionFiles?: VersionFileConfig[];
  /** Repository root, required when `versionFiles` is set */
  repoRoot?: string;
}

/**
 * Run pre-release command or automatic version bumping.
 *
 * Priority: custom command > automatic bumping (minVersion >= 2.21.0) > default script
 */
export async function runPreReleaseCommand(
  options: PreReleaseOptions,
): Promise<boolean> {
  const {
    oldVersion,
    newVersion,
    preReleaseCommand,
    targets = [],
    rootDir,
    versionFiles = [],
    repoRoot = rootDir,
  } = options;

  if (preReleaseCommand !== undefined && preReleaseCommand.length === 0) {
    logger.warn('Not running the pre-release command: no command specified');
    return false;
  }

  if (preReleaseCommand) {
    return runCustomPreReleaseCommand(
      oldVersion,
      newVersion,
      preReleaseCommand,
    );
  }

  if (
    requiresMinVersion(AUTO_BUMP_MIN_VERSION) &&
    (targets.length > 0 || versionFiles.length > 0)
  ) {
    logger.info('Running automatic version bumping...');
    const result = await runAutomaticVersionBumps(targets, rootDir, newVersion);
    const versionFilePaths = updateVersionFiles(
      versionFiles,
      repoRoot,
      newVersion,
    );

    if (!result.anyBumped && versionFilePaths.length === 0) {
      if (result.bumpableTargets.length === 0) {
        logger.warn(
          'None of your configured targets support automatic version bumping. ' +
            'Consider adding a preReleaseCommand to bump versions manually.',
        );
      } else {
        throw new ConfigurationError(
          `Targets [${result.skippedTargets.join(', ')}] support version bumping ` +
            'but did not find applicable files in your project. ' +
            'Define a preReleaseCommand to bump versions manually, or set ' +
            "preReleaseCommand: '' to skip version bumping.",
        );
      }
    }

    return result.anyBumped || versionFilePaths.length > 0;
  }

  return runCustomPreReleaseCommand(oldVersion, newVersion, undefined);
}

/**
 * Run a custom pre-release command (or the default bump-version.sh script)
 */
async function runCustomPreReleaseCommand(
  oldVersion: string,
  newVersion: string,
  preReleaseCommand?: string,
): Promise<boolean> {
  let sysCommand: string;
  let args: string[];

  // This is a workaround for the case when the old version is empty, which
  // should only happen when the project is new and has no version yet.
  // Instead of using an empty string, we use "0.0.0" as the old version to
  // avoid breaking the pre-release command as most scripts expect a non-empty
  // version string.
  const nonEmptyOldVersion = oldVersion || '0.0.0';

  if (preReleaseCommand) {
    [sysCommand, ...args] = shellQuote.parse(preReleaseCommand) as string[];
  } else {
    sysCommand = '/bin/bash';
    args = [DEFAULT_BUMP_VERSION_PATH];
  }

  args = [...args, nonEmptyOldVersion, newVersion];
  logger.info('Running the pre-release command...');

  // The pre-release command comes from .craft.yml, which is
  // attacker-influenceable via untrusted PRs. We forward only an
  // allowlisted env plus the CRAFT_* version vars to avoid leaking
  // secrets into a potentially malicious command. See
  // src/utils/releaseCommandEnv.ts for the exact allowlist and rationale.
  await spawnProcess(sysCommand, args, {
    env: buildReleaseCommandEnv({
      CRAFT_NEW_VERSION: newVersion,
      CRAFT_OLD_VERSION: nonEmptyOldVersion,
    }),
  });

  return true;
}
