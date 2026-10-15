import { isSea } from 'node:sea';
import { join } from 'node:path';
import type { Argv } from 'yargs';
import {
  getInstallDirectory,
  getNativeFilename,
  installNativeBinary,
} from '../utils/nativeInstallation';
import { logger } from '../logger';

export const command = 'setup';
export const description = 'Install a standalone Craft executable';
export const builder = (argv: Argv) =>
  argv
    .option('install', {
      type: 'boolean',
      demandOption: true,
      description: 'Install this standalone executable',
    })
    .option('install-dir', {
      type: 'string',
      description: 'Installation directory (env: CRAFT_INSTALL_DIR)',
    });

export async function handler(argv: {
  install: boolean;
  installDir?: string;
}): Promise<void> {
  if (!argv.install || !isSea())
    throw new Error(
      'setup --install requires a standalone Craft binary. For npm/pnpm installations, use your package manager.',
    );
  const directory = argv.installDir || getInstallDirectory();
  const result = await installNativeBinary(
    process.execPath,
    join(directory, getNativeFilename()),
  );
  logger.info(`Craft installation: ${result.path}`);
  logger.info(`Ensure ${directory} is on your PATH to run craft.`);
}
