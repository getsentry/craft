import { spawn } from 'child_process';
import * as split from 'split';

import logger from '../logger';

/**
 * Strips env values from the options object
 *
 * @param options Options passed to spawn
 */
function stripEnv(options: any = {}): any {
  const copy = { ...options };
  delete copy.env;
  return copy;
}

/**
 * Creates an error object and attaches the error code
 *
 * @param code A non-zero error code
 * @param command The command to run
 * @param args Optional arguments to pass to the command
 * @param options Optional options to pass to child_process.spawn
 * @returns The error with code
 */
function processError(
  code: number | string,
  command: string,
  args?: string[],
  options?: any
): Error {
  const error = new Error(
    `Process "${command}" errored with code ${code}`
  ) as any;
  error.code = code;
  error.args = args;
  error.options = stripEnv(options);
  return error;
}

/**
 * Asynchronously spawns a child process
 *
 * @param command The command to run
 * @param args Optional arguments to pass to the command
 * @param options Optional options to pass to child_process.spawn
 * @param logger A logger to pipe stdout and stderr to
 * @returns A promise that resolves when the child process exists
 * @async
 */
export async function spawnProcess(
  command: string,
  args?: string[],
  options?: any
): Promise<any> {
  return new Promise<any>((resolve, reject) => {
    try {
      logger.debug('Spawning process:', `${command} ${args}`);
      const child = spawn(command, args, options);
      child.on(
        'exit',
        code =>
          code === 0
            ? resolve()
            : reject(processError(code, command, args, options))
      );
      child.on('error', (error: any) =>
        reject(processError(error.code, command, args, options))
      );

      child.stdout
        .pipe(split())
        .on('data', (data: any) => logger.debug(`${command}: ${data}`));
      child.stderr
        .pipe(split())
        .on('data', (data: any) => logger.debug(`${command}: ${data}`));
    } catch (e) {
      reject(processError(e.code, command, args, options));
    }
  });
}
