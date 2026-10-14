import { existsSync } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { dirname, join, delimiter, isAbsolute, resolve } from 'node:path';
import { homedir } from 'node:os';
import { safeFs, safeFsPromises } from './dryRun';
import { isDryRun } from './helpers';
import { logger } from '../logger';

export function getNativeFilename(
  platform = process.platform as string,
  arch = process.arch as string,
): string {
  if (
    (platform === 'win32' && arch === 'x64') ||
    (['darwin', 'linux'].includes(platform) && ['x64', 'arm64'].includes(arch))
  )
    return platform === 'win32' ? 'craft.exe' : 'craft';
  throw new Error(`Unsupported standalone platform: ${platform}-${arch}`);
}

export function getInstallDirectory(
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): string {
  if (env.CRAFT_INSTALL_DIR) return resolve(env.CRAFT_INSTALL_DIR);
  if (env.XDG_BIN_HOME && isAbsolute(env.XDG_BIN_HOME)) return env.XDG_BIN_HOME;
  const paths = (env.PATH || '').split(delimiter).map(path => resolve(path));
  for (const dir of [join(home, '.local/bin'), join(home, 'bin')])
    if (existsSync(dir) && paths.includes(dir)) return dir;
  return join(home, '.local/bin');
}

export async function installNativeBinary(
  source: string,
  destination: string,
  platform = process.platform as string,
): Promise<{ path: string; backup?: string }> {
  const target = resolve(destination);
  if (isDryRun()) {
    logger.info(`[dry-run] Would install Craft to ${target}`);
    return { path: target };
  }
  const dir = dirname(target);
  await safeFs.mkdir(dir, { recursive: true });
  const lock = join(dir, '.craft-install.lock');
  try {
    await safeFs.mkdir(lock, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      throw new Error(
        `An installation/update lock already exists: ${lock}. If an earlier operation was interrupted, remove it only after verifying no installer is running.`,
      );
    throw error;
  }
  const suffix = randomBytes(12).toString('hex');
  const staged = join(
    dir,
    `.craft-install-${suffix}${platform === 'win32' ? '.exe' : ''}`,
  );
  let backup: string | undefined;
  try {
    let existing = false;
    try {
      const stat = await lstat(target);
      if (stat.isSymbolicLink() || !stat.isFile())
        throw new Error(`Refusing non-file or symlink destination: ${target}`);
      existing = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await safeFs.copyFile(source, staged);
    await safeFsPromises.chmod(staged, 0o755);
    if (platform === 'win32' && existing) {
      backup = `${target}.old-${suffix}`;
      await safeFs.rename(target, backup);
      try {
        await safeFs.rename(staged, target);
      } catch (error) {
        try {
          await safeFs.rename(backup, target);
        } catch (rollback) {
          throw new AggregateError(
            [error, rollback],
            `Replacement failed; original Craft is retained at ${backup}`,
          );
        }
        throw error;
      }
      // A running Windows image can be renamed, but cannot always be deleted.
      try {
        await safeFs.unlink(backup);
        backup = undefined;
      } catch {
        logger.info(
          `Previous executable retained at ${backup}; remove it after older Craft processes exit.`,
        );
      }
    } else {
      await safeFs.rename(staged, target);
    }
    return { path: target, backup };
  } finally {
    await safeFs.rm(staged, { force: true });
    await safeFs.rm(lock, { recursive: true });
  }
}
