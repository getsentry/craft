import { spawn, SpawnOptions } from 'child_process';
import { createHash } from 'crypto';
import { isDryRun } from 'dryrun';
import * as fs from 'fs';
import * as path from 'path';
import * as split from 'split';

import logger from '../logger';
import { reportError } from './errors';

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
 * @param stdout Standard output of the command
 * @param stderr Standard error of the command
 * @returns The error with code
 */
function processError(
  code: number | string,
  command: string,
  args?: string[],
  options?: any,
  stdout?: string,
  stderr?: string
): Error {
  const error = new Error(
    `Process "${command}" errored with code ${code}\n\nSTDOUT: ${stdout}\n\nSTDERR:${stderr}`
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
 * @param showStdout Do not buffer stdandard output
 * @returns A promise that resolves when the child process exists
 * @async
 */
export async function spawnProcess(
  command: string,
  args: string[] = [],
  options: SpawnOptions = {},
  showStdout: boolean = false
): Promise<any> {
  const argsString = args.map(arg => `"${arg}"`).join(' ');

  if (isDryRun()) {
    logger.info('[dry-run] Not spawning process:', `${command} ${argsString}`);
    return undefined;
  }

  return new Promise<any>((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let child;
    try {
      logger.debug('Spawning process:', `${command} ${argsString}`);
      // Do a shell-like replacement of arguments that look like environment variables
      const processedArgs = args.map(arg =>
        replaceEnvVariable(arg, { ...process.env, ...options.env })
      );
      // Allow child to accept input
      options.stdio = ['inherit', 'pipe', 'pipe'];
      child = spawn(command, processedArgs, options);
      child.on(
        'exit',
        code =>
          code === 0
            ? resolve()
            : reject(processError(code, command, args, options, stdout, stderr))
      );
      child.on('error', (error: any) =>
        reject(processError(error.code, command, args, options, stdout, stderr))
      );

      child.stdout.pipe(split()).on('data', (data: any) => {
        const output = `${command}: ${data}`;
        if (showStdout) {
          logger.info(output);
        } else {
          logger.debug(output);
        }
        stdout += `${output}\n`;
      });
      child.stderr.pipe(split()).on('data', (data: any) => {
        const output = `${command}: ${data}`;
        logger.debug(output);
        stderr += `${output}\n`;
      });
    } catch (e) {
      reject(processError(e.code, command, args, options, stdout, stderr));
    }
  });
}

/**
 * Calculates the checksum of a file's contents
 *
 * @param filePath The path to a file to process
 * @param algorithm A hashing algorithm, defaults to "sha256"
 * @returns The checksum as hex string
 */
export async function calculateChecksum(
  filePath: string,
  algorithm: string = 'sha256'
): Promise<string> {
  logger.debug(`Calculating "${algorithm}" hashsum for file: ${filePath}`);
  const stream = fs.createReadStream(filePath);
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

/**
 * Get current PATH and concatenate every entry with the provided file path
 *
 * @param fileName Base name of the given file
 */
function getPotentialPaths(fileName: string): string[] {
  const envPath = process.env.PATH || '';
  const envExt = process.env.PATHEXT || '';
  return envPath
    .replace(/"/g, '')
    .split(path.delimiter)
    .map(chunk =>
      envExt.split(path.delimiter).map(ext => path.join(chunk, fileName + ext))
    )
    .reduce((a, b) => a.concat(b));
}

/**
 * Checks if the provided path contains an executable file
 *
 * @param filePath Path to the file
 * @returns True if the file exists and is an executable
 */
function isExecutable(filePath: string): boolean {
  try {
    // tslint:disable-next-line:no-bitwise
    fs.accessSync(filePath, fs.constants.F_OK | fs.constants.X_OK);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Checks if the provided executable is available
 *
 * The argument can be a path (the function checks if it's an executable
 * or a binary name (the binary will be looked up in PATH)
 *
 * @param name Executable name
 * @returns True if executable is found in PATH
 */
export function hasExecutable(name: string): boolean {
  // Relative/absolute path
  if (name.indexOf('/') > -1) {
    return isExecutable(name);
  }
  const found = getPotentialPaths(name).find(isExecutable) || [];
  return !!found.length;
}

/**
 * Raises an error if the executable is not found
 *
 * @param name Executable name
 */
export function checkExecutableIsPresent(name: string): void {
  if (!hasExecutable(name)) {
    reportError(`Executable "${name}" not found. Is it installed?`);
  }
}
