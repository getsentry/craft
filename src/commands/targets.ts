import { getConfiguration } from '../config';
import { formatJson } from '../utils/strings';
import { getAllTargetNames, getTargetId } from '../targets';

export const command = ['targets'];
export const description = 'List defined targets as JSON array';

export function handler(): any {
  const definedTargets = getConfiguration().targets || [];
  const possibleTargetNames = new Set(getAllTargetNames());
  const allowedTargetNames = definedTargets
    .filter((target) => target.name && possibleTargetNames.has(target.name))
    .map(getTargetId);

  console.log(formatJson(allowedTargetNames));
}
