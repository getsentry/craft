import { BaseTarget } from './base';
import { GithubTarget } from './github';
import { NpmTarget } from './npm';

export const TARGET_MAP: { [key: string]: typeof BaseTarget } = {
  github: GithubTarget,
  npm: NpmTarget,
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
