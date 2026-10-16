/**
 * Helpers for stripping dynamic-linker environment variables
 * (`LD_PRELOAD`, `LD_LIBRARY_PATH`, `DYLD_*`, etc.) from Craft's own
 * environment and from environments passed to subprocess spawns.
 *
 * These variables are a well-known supply-chain attack vector: an
 * attacker who can influence the environment of a process can load an
 * arbitrary shared library into every subprocess it spawns, gaining
 * code execution with access to every credential those subprocesses
 * touch (GitHub tokens, npm tokens, GPG keys, ...).
 *
 * This module has intentionally minimal imports (just the logger) so
 * it can be safely imported from low-level utilities like
 * `src/utils/system.ts` without creating a circular dependency with
 * `src/config.ts` / the artifact providers.
 */

import { logger } from '../logger';

/**
 * Environment variable names Craft refuses to propagate.
 *
 * Any legitimate use (e.g. an instrumented build toolchain that relies
 * on `LD_LIBRARY_PATH`) can be re-enabled for a single Craft
 * invocation via {@link ALLOW_DYNAMIC_LINKER_ENV_VAR}.
 */
export const DYNAMIC_LINKER_ENV_VARS = [
  // Linux / glibc / musl
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'LD_AUDIT',
  // macOS dyld
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',
  'DYLD_FRAMEWORK_PATH',
  'DYLD_FALLBACK_LIBRARY_PATH',
  'DYLD_FALLBACK_FRAMEWORK_PATH',
] as const;

/**
 * Opt-out environment variable. When set to exactly `"1"` in
 * `process.env`, {@link sanitizeDynamicLinkerEnv} and
 * {@link sanitizeSpawnEnv} become no-ops.
 *
 * Noisy by design: both helpers log whenever the opt-out is in effect,
 * so the escape hatch is visible in CI logs.
 */
export const ALLOW_DYNAMIC_LINKER_ENV_VAR = 'CRAFT_ALLOW_DYNAMIC_LINKER_ENV';

/**
 * Strips dynamic-linker environment variables from `process.env` at
 * startup, logging a warning per stripped key. Values are never logged.
 */
export function sanitizeDynamicLinkerEnv(): void {
  const allowOverride = process.env[ALLOW_DYNAMIC_LINKER_ENV_VAR] === '1';
  const presentKeys = DYNAMIC_LINKER_ENV_VARS.filter(
    key => process.env[key] !== undefined,
  );

  if (presentKeys.length === 0) {
    return;
  }

  if (allowOverride) {
    logger.info(
      `${ALLOW_DYNAMIC_LINKER_ENV_VAR}=1 set; preserving dynamic-linker environment variables: ${presentKeys.join(
        ', ',
      )}. This is not recommended.`,
    );
    return;
  }

  for (const key of presentKeys) {
    logger.warn(
      `Stripping dynamic-linker environment variable "${key}" for security reasons. ` +
        `Set ${ALLOW_DYNAMIC_LINKER_ENV_VAR}=1 to override (not recommended).`,
    );
    delete process.env[key];
  }
}

/**
 * Returns a copy of `env` with dynamic-linker environment variables
 * removed. If the global opt-out `CRAFT_ALLOW_DYNAMIC_LINKER_ENV=1` is
 * set on `process.env`, the input is returned unchanged.
 *
 * Defence-in-depth for subprocess spawns: even if an earlier code path
 * somehow restores one of these variables to `process.env` after
 * startup, or a caller explicitly constructs an `env` object that
 * contains one (e.g. via `{ ...process.env, ...custom }`), the spawned
 * child still won't inherit it. Values are never logged.
 *
 * @param env Environment variables bag to sanitise. The input is
 *   never mutated.
 * @returns A shallow copy with dynamic-linker keys removed; or the
 *   original reference when input is `undefined` or when the opt-out
 *   is in effect.
 */
export function sanitizeSpawnEnv(
  env: NodeJS.ProcessEnv | undefined,
): NodeJS.ProcessEnv | undefined {
  if (env === undefined) {
    return env;
  }
  if (process.env[ALLOW_DYNAMIC_LINKER_ENV_VAR] === '1') {
    return env;
  }
  const sanitized: NodeJS.ProcessEnv = { ...env };
  let strippedAny = false;
  for (const key of DYNAMIC_LINKER_ENV_VARS) {
    if (sanitized[key] !== undefined) {
      delete sanitized[key];
      strippedAny = true;
    }
  }
  if (strippedAny) {
    logger.warn(
      `Stripped dynamic-linker environment variable(s) from a subprocess env. ` +
        `Set ${ALLOW_DYNAMIC_LINKER_ENV_VAR}=1 to override (not recommended).`,
    );
  }
  return sanitized;
}
