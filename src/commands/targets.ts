import { getConfiguration, expandWorkspaceTargets } from '../config';
import { formatJson } from '../utils/strings';
import { getAllTargetNames } from '../targets';
import { BaseTarget } from '../targets/base';

export const command = ['targets'];
export const description = 'List defined targets as JSON array';

/**
 * Returns the IDs of the configured targets, with workspace targets expanded.
 */
export async function getTargetIds(): Promise<string[]> {
  // Expand workspace targets (e.g., npm workspaces)
  const definedTargets = await expandWorkspaceTargets(
    getConfiguration().targets || [],
  );

  const possibleTargetNames = new Set(getAllTargetNames());
  return definedTargets
    .filter(target => target.name && possibleTargetNames.has(target.name))
    .map(BaseTarget.getId);
}

export async function handler(): Promise<any> {
  console.log(formatJson(await getTargetIds()));
}
