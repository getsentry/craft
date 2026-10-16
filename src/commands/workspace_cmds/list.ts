import { getWorkspaceNames } from '../../config';
import { formatJson } from '../../utils/strings';

export const command = ['list'];
export const description = 'List defined release workspaces as a JSON array';

export function handler(): void {
  console.log(formatJson(getWorkspaceNames()));
}
