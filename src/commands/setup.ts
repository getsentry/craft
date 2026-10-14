import { isSea } from 'node:sea';
import { join } from 'node:path';
import type { Argv } from 'yargs';
import {
  getInstallDirectory,
  getNativeFilename,
  installNativeBinary,
} from '../utils/nativeInstallation';
import { configureCompletions, SHELLS } from '../utils/completions';
import { logger } from '../logger';

export const command = 'setup';
export const description =
  'Configure Craft shell integration and install standalone binaries';
export const builder = (argv: Argv) =>
  argv
    .option('install', {
      type: 'boolean',
      default: false,
      description: 'Install this standalone executable',
    })
    .option('shell', {
      type: 'string',
      choices: SHELLS,
      description: 'Completion shell (defaults to $SHELL)',
    })
    .option('no-completions', {
      type: 'boolean',
      default: false,
      description: 'Skip shell completion installation',
    })
    .option('install-dir', {
      type: 'string',
      description: 'Installation directory (env: CRAFT_INSTALL_DIR)',
    });

export async function handler(argv: {
  install: boolean;
  installDir?: string;
  shell?: string;
  noCompletions?: boolean;
}): Promise<void> {
  if (argv.install && !isSea())
    throw new Error(
      'setup --install requires a standalone Craft binary. For npm/pnpm installations, use your package manager.',
    );
  if (argv.install) {
    const directory = argv.installDir || getInstallDirectory();
    const result = await installNativeBinary(
      process.execPath,
      join(directory, getNativeFilename()),
    );
    logger.info(`Craft installation: ${result.path}`);
    logger.info(`Ensure ${directory} is on your PATH to run craft.`);
  }
  if (!argv.noCompletions) await configureCompletions(argv.shell);
}
