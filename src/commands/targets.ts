import { Argv, CommandBuilder } from 'yargs';
import { getConfiguration } from '../config';
import { getAllTargetNames, getTargetId } from '../targets';

export const builder: CommandBuilder = (yargs: Argv) => {
  return yargs;
};

export function handler(): any {
  const definedTargets = getConfiguration().targets || [];
  const possibleTargetNames = new Set(getAllTargetNames());
  const allowedTargetNames = definedTargets
    .filter(target => target.name && possibleTargetNames.has(target.name))
    .map(getTargetId);

  console.log(JSON.stringify(allowedTargetNames));
}
