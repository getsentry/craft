import { getConfiguration, expandWorkspaceTargets } from '../config';
import { formatJson } from '../utils/strings';
import { getAllTargetNames } from '../targets';
import { BaseTarget } from '../targets/base';

export const command = ['targets'];
export const description = 'List defined targets as JSON array';

export async function handler(): Promise<any> {
  let definedTargets = getConfiguration().targets || [];

  // Expand workspace targets (e.g., npm workspaces)
  definedTargets = await expandWorkspaceTargets(definedTargets);

  const possibleTargetNames = new Set(getAllTargetNames());
  const allowedTargetNames = definedTargets
    .filter(target => target.name && possibleTargetNames.has(target.name))
    .map(BaseTarget.getId);

  console.log(formatJson(allowedTargetNames));
}
