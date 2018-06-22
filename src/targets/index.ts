import { BaseTarget } from './base';
import { GithubTarget } from './github';

export const TARGET_MAP: { [key: string]: typeof BaseTarget } = {
  github: GithubTarget,
};

export function getTargetByName(
  targetName: string
): typeof BaseTarget | undefined {
  return TARGET_MAP[targetName];
}
