import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import rimraf from 'rimraf';
import * as tmp from 'tmp';
import * as util from 'util';

import { filterAsync } from './async';
import { logger } from '../logger';

const lstat = util.promisify(fs.lstat);
const readdirp = util.promisify(fs.readdir);
const mkdtemp = util.promisify(fs.mkdtemp);
const readdir = util.promisify(fs.readdir);

/**
 * Lists all files traversing through subfolders.
 *
 * The path should be given absolute. Relative paths are evaluated from the
 * current working directory. Throws if the path is missing. The resulting
 * file paths are joined with the path argument, and thus also absolute or
 * relative depending on the input parameter.
 *
 * @param directory The path to the directory
 * @returns A list of paths to files within the directory
 */
export async function scan(
  directory: string,
  results: string[] = []
): Promise<string[]> {
  const files = await readdirp(directory);
  for (const f of files) {
    const fullPath = path.join(directory, f);
    const stat = await lstat(fullPath);
    if (stat.isDirectory()) {
      await scan(fullPath, results);
    } else {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Lists all direct files within the specified directory, skipping directories
 * and symlinks
 *
 * The path should be given absolute. Relative paths are evaluated from the
 * current working directory. Throws if the path is missing. The resulting
 * file paths are joined with the path argument, and thus also absolute or
 * relative depending on the input parameter.
 *
 * @param directory The path to the directory
 * @returns A list of paths to files within the directory
 */
export async function listFiles(directory: string): Promise<string[]> {
  const files = await readdir(directory);
  const paths = files.map(name => path.join(directory, name));
  return filterAsync(paths, async filePath => {
    const stats = await lstat(filePath);
    return stats.isFile();
  });
}

/**
 * Execute an asynchronous callback within a temp directory
 *
 * If "cleanup" flag is set to true, automatically removes the directory and
 * all contents when the callback finishes or throws.
 *
 * @param callback A callback that receives the directory path
 * @param prefix A prefix to put in front of the new directory
 * @param cleanup A flag that configures clean-up behavior
 * @returns The return value of the callback
 */
export async function withTempDir<T>(
  callback: (arg: string) => T | Promise<T>,
  cleanup = true,
  prefix = 'craft-'
): Promise<T> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await callback(directory);
  } finally {
    if (cleanup) {
      rimraf(directory, err => {
        // XXX(BYK): intentionally DO NOT await unlinking as we do not want
        // to block (both in terms of waiting for IO and the success of the
        // operation) finishing the task at hand. If unlinking fails, we honestly
        // don't care as this is already a temporary file and will be removed
        // eventually by the OS. And it doesn't make sense to wait until this op
        // finishes then as nothing relies on the removal of this file.
        if (err) {
          logger.trace(`Couldn't remove temp dir ${directory}:`, err);
        }
      });
    }
  }
}

/**
 * Execute an asynchronous callback with a temporary file
 *
 * If "cleanup" flag is set to true, automatically removes the file when the
 * callback finishes or throws.
 *
 * @param callback A callback that receives the file path
 * @param prefix A prefix to put in front of the new file
 * @param cleanup A flag that configures clean-up behavior
 * @returns The return value of the callback
 */
export async function withTempFile<T>(
  callback: (arg: string) => T | Promise<T>,
  cleanup = true,
  prefix = 'craft-'
): Promise<T> {
  tmp.setGracefulCleanup();
  const tmpFile = tmp.fileSync({ prefix });
  try {
    return await callback(tmpFile.name);
  } finally {
    if (cleanup) {
      tmpFile.removeCallback();
    }
  }
}

/**
 * Detect the content-type based on the file's extension.
 *
 * @param artifactName Name of the artifact to check
 * @returns A content-type string, or undefined if the artifact name doesn't
 * have a known extension
 */
export function detectContentType(artifactName: string): string | undefined {
  const extensionToType: Array<[RegExp, string]> = [
    [/\.js$/, 'application/javascript; charset=utf-8'],
    [/\.js\.map$/, 'application/json; charset=utf-8'],
  ];
  for (const entry of extensionToType) {
    const [regex, contentType] = entry;
    if (artifactName.match(regex)) {
      return contentType;
    }
  }
  return undefined;
}
