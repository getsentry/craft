import type { Argv } from 'yargs';
import {
  detectCompletionShell,
  getCompletionScript,
  SHELLS,
} from '../utils/completions';
export const command = 'completion [shell]';
export const description = 'Print a shell completion script';
export const builder = (argv: Argv) =>
  argv.positional('shell', {
    type: 'string',
    choices: SHELLS,
    description: 'Shell (defaults to $SHELL)',
  });
export async function handler(argv: { shell?: string }): Promise<void> {
  process.stdout.write(
    getCompletionScript(argv.shell || detectCompletionShell() || 'unknown'),
  );
}
