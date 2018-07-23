import { spawn, SpawnOptions } from 'child_process';
import { createHash } from 'crypto';
import { isDryRun } from 'dryrun';
import { createReadStream } from 'fs';
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
 * Performs an environment expansion for the provided string
 *
 * The expansion is performed only when the entire string has the form
 * of "${...}", i.e. string "$ENV_VAR" will not be expanded.
 *
 * @param arg String to process
 * @param env Environment-like key-value mapping
 */
export function replaceEnvVariable(arg: string, env: any): string {
  if (!env || !arg || arg[0] !== '$') {
    return arg;
  }

  const argLen = arg.length;
  if (arg[1] === '{' && arg[argLen - 1] === '}') {
    const envVarKey = arg.slice(2, argLen - 1);
    return env[envVarKey] || '';
  } else {
    return arg;
  }
}

/**
 * Asynchronously spawns a child process
 *
 * Process arguments that have the form ${...} will be replaced with the values
 * of the corresponding environment variables.
 *
 * WARNING: secret values (passwords, tokens) passed via the environmnet
 * variable on the command line may be visible in the process list.
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
  args: string[] = [],
  options: SpawnOptions = {}
): Promise<any> {
  const argsString = args.map(arg => `"${arg}"`).join(' ');

  if (isDryRun()) {
    logger.debug('[dry-run] Not spawning process:', `${command} ${argsString}`);
    return undefined;
  }

  return new Promise<any>((resolve, reject) => {
    try {
      logger.debug('Spawning process:', `${command} ${argsString}`);
      // Do a shell-like replacement of arguments that look like environment variables
      const processedArgs = args.map(arg =>
        replaceEnvVariable(arg, options.env)
      );
      const child = spawn(command, processedArgs, options);
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

/**
 * Calculates the checksum of a file's contents
 *
 * @param path The path to a file to process
 * @param algorithm A hashing algorithm, defaults to "sha256"
 * @returns The checksum as hex string
 */
export async function calculateChecksum(
  path: string,
  algorithm: string = 'sha256'
): Promise<string> {
  logger.debug(`Calculating "${algorithm}" hashsum for file: ${path}`);
  const stream = createReadStream(path);
  const hash = createHash(algorithm);

  return new Promise<string>((resolve, reject) => {
    stream.on('data', data => hash.update(data, 'utf8'));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * Sleep for the provided number of milliseconds
 *
 * @param ms Milliseconds to sleep
 */
export async function sleepAsync(ms: number): Promise<void> {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}
