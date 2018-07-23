import { BaseTarget } from './base';
import { BrewTarget } from './brew';
import { GithubTarget } from './github';
import { NpmTarget } from './npm';
import { NugetTarget } from './nuget';
import { PypiTarget } from './pypi';

export const TARGET_MAP: { [key: string]: typeof BaseTarget } = {
  brew: BrewTarget,
  github: GithubTarget,
  npm: NpmTarget,
  nuget: NugetTarget,
  pypi: PypiTarget,
};

/**
 * Convert target name to class object
 *
 * @param targetName Name of the target
 */
export function getTargetByName(
  targetName: string
): typeof BaseTarget | undefined {
  return TARGET_MAP[targetName];
}
