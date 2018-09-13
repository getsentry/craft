import { spawn, SpawnOptions } from 'child_process';
import { createHash } from 'crypto';
import { isDryRun } from 'dryrun';
import * as fs from 'fs';
import * as path from 'path';
import * as split from 'split';
import { Readable } from 'stream';
import * as tar from 'tar';
import * as unzipper from 'unzipper';

import logger from '../logger';
import { reportError } from './errors';
import { downloadSources } from './github_api';

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
 * Additional options for spawnProcess() function
 */
export interface SpawnProcessOptions {
  /** Do not buffer standard output */
  showStdout?: boolean;
  /** Force the process to run in dry-run mode */
  enableInDryRunMode?: boolean;
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
 * @param spawnProcessOptions Additional options to this function
 * @returns A promise that resolves with the standard output when the child process exists
 * @async
 */
export async function spawnProcess(
  command: string,
  args: string[] = [],
  options: SpawnOptions = {},
  spawnProcessOptions: SpawnProcessOptions = {}
): Promise<Buffer | undefined> {
  const argsString = args.map(arg => `"${arg}"`).join(' ');

  if (isDryRun() && !spawnProcessOptions.enableInDryRunMode) {
    logger.info('[dry-run] Not spawning process:', `${command} ${argsString}`);
    return undefined;
  }

  return new Promise<any>((resolve, reject) => {
    const stdoutChunks: Buffer[] = [];
    let stdout = '';
    let stderr = '';
    let child;

    // NOTE: On Linux, stdout and stderr might flush immediately after the
    // process exists. By adding a 0 timeout, we can make sure that the promise
    // is not resolved before both pipes have finished.
    const succeed = () =>
      setTimeout(() => resolve(Buffer.concat(stdoutChunks)), 0);
    const fail = (e: any) =>
      reject(processError(e.code, command, args, options, stdout, stderr));

    try {
      logger.debug('Spawning process:', `${command} ${argsString}`);

      // Do a shell-like replacement of arguments that look like environment variables
      const processedArgs = args.map(arg =>
        replaceEnvVariable(arg, { ...process.env, ...options.env })
      );

      // Allow child to accept input
      options.stdio = ['inherit', 'pipe', 'pipe'];
      child = spawn(command, processedArgs, options);
      child.on('exit', code => (code === 0 ? succeed() : fail({ code })));
      child.on('error', fail);

      child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));

      child.stdout.pipe(split()).on('data', (data: any) => {
        const output = `${command}: ${data}`;
        if (spawnProcessOptions.showStdout) {
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
      fail(e);
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

/**
 * Extracts a source code tarball in the specified directory
 *
 * The tarball should contain a top level directory that contains all source
 * files. The contents of that directory are directly extracted into the `dir`
 * location.
 *
 * @param stream A stream containing the source tarball
 * @param dir Path to the directory to extract in
 * @returns A promise that resolves when the tarball has been extracted
 * @async
 */
export async function extractSourcesFromTarStream(
  stream: Readable,
  dir: string
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    try {
      stream
        .pipe(tar.extract({ strip: 1, cwd: dir }))
        .on('error', reject)
        .on('finish', () => {
          setTimeout(resolve, 100);
        });
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Extracts a ZIP archive in the specified directory
 *
 * @param filePath An archive path
 * @param dir Path to the directory to extract in
 * @returns A promise that resolves when the tarball has been extracted
 * @async
 */
export async function extractZipArchive(
  filePath: string,
  dir: string
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    try {
      fs.createReadStream(filePath)
        .pipe(unzipper.Extract({ strip: 1, path: dir }))
        .on('error', reject)
        .on('finish', () => {
          setTimeout(resolve, 100);
        });
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Downloads source code of the Github repository and puts it in the specified
 * directory
 *
 * @param owner Repository owner
 * @param repo Repository name
 * @param sha Revision SHA identifier
 * @param directory A directory to extract to
 * @returns A promise that resolves when the sources are ready
 */
export async function downloadAndExtract(
  owner: string,
  repo: string,
  sha: string,
  directory: string
): Promise<void> {
  const stream = await downloadSources(owner, repo, sha);
  logger.info(`Extracting sources to ${directory}`);
  return extractSourcesFromTarStream(stream, directory);
}
