import { BaseTarget } from './base';
import { BrewTarget } from './brew';
import { CratesTarget } from './crates';
import { GcsTarget } from './gcs';
import { GhPagesTarget } from './gh-pages';
import { GithubTarget } from './github';
import { NpmTarget } from './npm';
import { NugetTarget } from './nuget';
import { PypiTarget } from './pypi';
import { RegistryTarget } from './registry';

export const TARGET_MAP: { [key: string]: typeof BaseTarget } = {
  brew: BrewTarget,
  crates: CratesTarget,
  gcs: GcsTarget,
  'gh-pages': GhPagesTarget,
  github: GithubTarget,
  npm: NpmTarget,
  nuget: NugetTarget,
  pypi: PypiTarget,
  registry: RegistryTarget,
};

/**
 * Get a list of all available targets
 *
 * @returns List of targets
 */
export function getAllTargetNames(): string[] {
  return Object.keys(TARGET_MAP);
}

/**
 * Convert target name to class object
 *
 * @param targetName Name of the target
 * @returns Corresponding target class or undefined
 */
export function getTargetByName(
  targetName: string
): typeof BaseTarget | undefined {
  return TARGET_MAP[targetName];
}
