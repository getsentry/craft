import type { Argv } from 'yargs';
import { updateNativeBinary } from '../utils/nativeUpdate';
export const command = 'update [releaseVersion]';
export const description = 'Update a standalone Craft executable';
export const builder = (argv: Argv) =>
  argv
    .positional('releaseVersion', {
      type: 'string',
      description: 'Published version (defaults to latest stable)',
    })
    .option('check', {
      type: 'boolean',
      default: false,
      description: 'Check without downloading or replacing the executable',
    })
    .option('force', {
      type: 'boolean',
      default: false,
      description: 'Allow reinstalling the same version or downgrading',
    });
export async function handler(argv: {
  releaseVersion?: string;
  check: boolean;
  force: boolean;
}): Promise<void> {
  await updateNativeBinary({
    version: argv.releaseVersion,
    check: argv.check,
    force: argv.force,
  });
}
