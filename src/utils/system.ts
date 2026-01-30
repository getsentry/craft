import { spawn, SpawnOptions } from 'child_process';
import { createHash, Hash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import split from 'split';
import * as tar from 'tar';
import extract from 'extract-zip';

import { logger } from '../logger';

import { reportError } from './errors';
import { isDryRun } from './helpers';
import { isInWorktreeMode } from './dryRun';

/**
 * Types of supported hashing algorithms
 */
export enum HashAlgorithm {
  /** SHA256 */
  SHA256 = 'sha256',
  /** SHA384 */
  SHA384 = 'sha384',
  /** SHA512 */
  SHA512 = 'sha512',
}

/**
 * Types of supported digest formats
 */
export enum HashOutputFormat {
  /** Hex digest, consists of [0-9a-f] characters */
  Hex = 'hex',
  /** The digest is encoded as base64 string. Used e.g. for Subresource Integrity (SRI) */
  Base64 = 'base64',
}

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
  stderr?: string,
): Error {
  const error = new Error(
    `Process "${command}" errored with code ${code}\n\nSTDOUT: ${stdout}\n\nSTDERR:${stderr}`,
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
export function replaceEnvVariable(
  arg: string,
  env: Record<string, any>,
): string {
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
  /** Data to write to stdin (process will receive 'pipe' for stdin instead of 'inherit') */
  stdin?: string;
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
  spawnProcessOptions: SpawnProcessOptions = {},
): Promise<Buffer | undefined> {
  const argsString = args.map(arg => `"${arg}"`).join(' ');

  // Allow spawning in worktree mode (isolated environment) or when explicitly enabled
  if (
    isDryRun() &&
    !spawnProcessOptions.enableInDryRunMode &&
    !isInWorktreeMode()
  ) {
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
      logger.trace('Spawning process:', `${command} ${argsString}`);

      // Do a shell-like replacement of arguments that look like environment variables
      const processedArgs = args.map(arg =>
        replaceEnvVariable(arg, { ...process.env, ...options.env }),
      );

      // Allow child to accept input (use 'pipe' for stdin if we need to write to it)
      options.stdio = [
        spawnProcessOptions.stdin !== undefined ? 'pipe' : 'inherit',
        'pipe',
        'pipe',
      ];
      child = spawn(command, processedArgs, options);

      if (!child.stdout || !child.stderr) {
        throw new Error('Invalid standard output or error for child process');
      }

      // Write stdin data if provided
      if (spawnProcessOptions.stdin !== undefined && child.stdin) {
        child.stdin.write(spawnProcessOptions.stdin);
        child.stdin.end();
      }
      child.on('exit', code => (code === 0 ? succeed() : fail({ code })));
      child.on('error', fail);

      child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));

      child.stdout.pipe(split()).on('data', (data: any) => {
        const output = `${command}: ${data}`;
        if (spawnProcessOptions.showStdout) {
          logger.info(output);
        } else {
          logger.trace(output);
        }
        stdout += `${output}\n`;
      });
      child.stderr.pipe(split()).on('data', (data: any) => {
        const output = `${command}: ${data}`;
        logger.trace(output);
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
 * @param options Digest options
 * @returns The checksum as hex string
 */
export async function calculateChecksum(
  filePath: string,
  options?: {
    /** Hash algorithm */
    algorithm?: HashAlgorithm;
    /** Hash format */
    format?: HashOutputFormat;
  },
): Promise<string> {
  const { algorithm = HashAlgorithm.SHA256, format = HashOutputFormat.Hex } =
    options || {};
  logger.debug(`Calculating "${algorithm}" hashsum for file: ${filePath}`);
  const stream = fs.createReadStream(filePath);
  const hash = createHash(algorithm);

  return new Promise<string>((resolve, reject) => {
    stream.on('data', data => hash.update(data));
    stream.on('end', () => resolve(formatDigest(hash, format)));
    stream.on('error', reject);
  });
}

/**
 * Format the digest of the given hash object
 *
 * @param hash Hash object
 * @param format Hash format
 * @returns Formatted digest
 */
function formatDigest(hash: Hash, format: HashOutputFormat): string {
  switch (format) {
    case HashOutputFormat.Base64: {
      return hash.digest('base64');
    }
    case HashOutputFormat.Hex: {
      return hash.digest('hex');
    }
    default: {
      throw new Error(`Invalid hash format: ${format}`);
    }
  }
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
      envExt.split(path.delimiter).map(ext => path.join(chunk, fileName + ext)),
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
 * Configuration for runWithExecutable helper
 */
export interface ExecutableConfig {
  /** Default binary name (e.g., 'npm', 'cargo') */
  name: string;
  /** Optional environment variable for custom binary path (e.g., 'NPM_BIN') */
  envVar?: string;
  /** Hint to show in error message when executable is not found */
  errorHint?: string;
}

/**
 * Resolves the executable path from config, checking env var override first
 *
 * @param config Executable configuration
 * @returns The resolved binary name/path
 */
export function resolveExecutable(config: ExecutableConfig): string {
  const { name, envVar } = config;
  return envVar ? process.env[envVar] || name : name;
}

/**
 * Result from findFirstExecutable when an executable is found
 */
export interface FoundExecutable {
  /** The resolved binary path */
  bin: string;
  /** The config that matched */
  config: ExecutableConfig;
  /** Index in the original array */
  index: number;
}

/**
 * Finds the first available executable from an array of configs
 *
 * @param configs Array of executable configurations to try in order
 * @returns The first found executable info, or undefined if none found
 *
 * @example
 * ```typescript
 * const found = findFirstExecutable([
 *   { name: 'npm', envVar: 'NPM_BIN' },
 *   { name: 'yarn', envVar: 'YARN_BIN' },
 * ]);
 * if (found) {
 *   console.log(`Using ${found.bin}`);
 * }
 * ```
 */
export function findFirstExecutable(
  configs: ExecutableConfig[],
): FoundExecutable | undefined {
  for (let i = 0; i < configs.length; i++) {
    const config = configs[i];
    const bin = resolveExecutable(config);
    if (hasExecutable(bin)) {
      return { bin, config, index: i };
    }
  }
  return undefined;
}

/**
 * Requires at least one executable from an array of configs to be present
 *
 * @param configs Array of executable configurations to try in order
 * @param errorHint Optional hint to show in error message
 * @returns The first found executable info
 * @throws Error if no executable is found
 *
 * @example
 * ```typescript
 * const { bin } = requireFirstExecutable(
 *   [{ name: 'npm' }, { name: 'yarn' }],
 *   'Install npm or yarn'
 * );
 * ```
 */
export function requireFirstExecutable(
  configs: ExecutableConfig[],
  errorHint?: string,
): FoundExecutable {
  const found = findFirstExecutable(configs);
  if (!found) {
    const names = configs.map(c => `"${resolveExecutable(c)}"`).join(' or ');
    const hint = errorHint ? ` ${errorHint}` : '';
    throw new Error(`Cannot find ${names}.${hint}`);
  }
  return found;
}

/**
 * Checks if an executable exists and runs it with the provided arguments
 *
 * This helper abstracts the common pattern of:
 * 1. Checking for an executable (with optional env var override)
 * 2. Throwing a helpful error if not found
 * 3. Running the command with provided arguments
 *
 * Accepts either a single config or an array of configs (tries in order).
 *
 * @param config Executable configuration or array of configs to try in order
 * @param args Arguments to pass to the executable
 * @param options Optional spawn options (cwd, env, etc.)
 * @param spawnOpts Optional spawn process options
 * @returns Promise resolving to stdout buffer
 * @throws Error if executable is not found
 *
 * @example
 * ```typescript
 * // Single executable
 * await runWithExecutable(
 *   { name: 'cargo', envVar: 'CARGO_BIN', errorHint: 'Install Rust toolchain' },
 *   ['build', '--release'],
 *   { cwd: projectDir }
 * );
 *
 * // Multiple executables (tries in order)
 * await runWithExecutable(
 *   [
 *     { name: 'npm', envVar: 'NPM_BIN' },
 *     { name: 'yarn', envVar: 'YARN_BIN' },
 *   ],
 *   ['install'],
 *   { cwd: projectDir }
 * );
 * ```
 */
export async function runWithExecutable(
  config: ExecutableConfig | ExecutableConfig[],
  args: string[],
  options: SpawnOptions = {},
  spawnOpts: SpawnProcessOptions = {},
): Promise<Buffer | undefined> {
  let bin: string;
  let errorHint: string | undefined;

  if (Array.isArray(config)) {
    const found = findFirstExecutable(config);
    if (!found) {
      const names = config.map(c => `"${resolveExecutable(c)}"`).join(' or ');
      // Use errorHint from the first config if available
      errorHint = config[0]?.errorHint;
      const hint = errorHint ? ` ${errorHint}` : ' Is it installed?';
      throw new Error(`Cannot find ${names}.${hint}`);
    }
    bin = found.bin;
  } else {
    bin = resolveExecutable(config);
    errorHint = config.errorHint;

    if (!hasExecutable(bin)) {
      const hint = errorHint ? ` ${errorHint}` : ' Is it installed?';
      throw new Error(`Cannot find "${bin}".${hint}`);
    }
  }

  logger.debug(`Running: ${bin} ${args.join(' ')}`);
  return spawnProcess(bin, args, options, spawnOpts);
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
  stream: NodeJS.ReadableStream,
  dir: string,
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
  dir: string,
): Promise<void> {
  await extract(filePath, { dir: dir });
}

/**
 * Sets SIGINT handler to avoid accidental process termination via Ctrl-C
 *
 * After the handler is set, the user should press Ctrl-C with less than
 * "maxTimeDiff" milliseconds apart.
 * The behavior is currently disabled by default.
 *
 * @param maxTimeDiff Maximum time interval in milliseconds between the signals
 */
export function catchKeyboardInterrupt(maxTimeDiff = 1000): void {
  if (process.env.CRAFT_CATCH_KEYBOARD_INTERRUPT !== '1') {
    logger.debug(
      'Catching Ctrl-C is disabled by default. See https://github.com/getsentry/craft/issues/21',
    );
    return;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    logger.debug('stdin or stdout is not a TTY, not catching SIGINTs');
    return;
  }

  // Dirty hack: SIGINT interception doesn't work well if we run "craft" as a
  // yarn script (for example, in development via "yarn cli"). The problem is
  // the external "yarn" process is killed, and no longer attached to stdout,
  // while the craft process receives only one SIGINT.
  // Hence, we're trying to detect if we run the script via yarn/npm.
  if ((process.env.npm_package_scripts_cli || '').indexOf('node') > -1) {
    logger.debug('NPM/Yarn script environment detected, not catching SIGINTs');
    return;
  }

  logger.debug('Setting custom SIGINT handler');
  let lastSignalTime = 0;
  process.on('SIGINT', () => {
    const now = Date.now();
    if (lastSignalTime && now - lastSignalTime <= maxTimeDiff) {
      logger.warn('Got ^C, exiting.');
      process.exit(1);
    } else {
      logger.warn('Press ^C again (quickly!) to exit.');
      lastSignalTime = now;
    }
  });
}
