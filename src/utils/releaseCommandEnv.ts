/**
 * Allowlist-based environment construction for user-defined release
 * commands (`preReleaseCommand` / `postReleaseCommand` from `.craft.yml`).
 *
 * `.craft.yml` is attacker-influenceable via untrusted PRs: a malicious
 * contributor can set `preReleaseCommand` to any shell command, and if we
 * forward the full `process.env` to the subprocess, they gain access to
 * every secret in the CI environment (GitHub tokens, npm tokens, GPG
 * keys, etc.) and can exfiltrate them.
 *
 * The mitigation is to forward only a small, explicit allowlist of
 * environment variables to the subprocess. Scripts that need additional
 * variables should be updated to read them from a secrets file, or to
 * use the `CRAFT_` prefix (which yargs surfaces as explicit CLI options).
 */

/**
 * Environment variables to pass through to user-defined release commands.
 *
 * - `HOME` is needed so Git can find `~/.gitconfig` with `safe.directory`
 *   settings, which fixes "fatal: detected dubious ownership in repository"
 *   errors in CI runners.
 * - `USER`, `GIT_COMMITTER_NAME`, `GIT_AUTHOR_NAME`, and `EMAIL` help with
 *   commit operations in post-release scripts.
 */
export const ALLOWED_ENV_VARS = [
  'HOME',
  'USER',
  'GIT_COMMITTER_NAME',
  'GIT_AUTHOR_NAME',
  'EMAIL',
] as const;

/**
 * Builds the environment for a user-defined release command subprocess.
 *
 * The returned env contains only:
 * - `PATH` (so the shell can locate the command),
 * - `GITHUB_TOKEN` (Craft's primary authentication credential, commonly
 *   required by release scripts to push tags, create releases, etc.),
 * - the keys listed in {@link ALLOWED_ENV_VARS},
 * - any caller-supplied `extras` (e.g. `CRAFT_NEW_VERSION`).
 *
 * Undefined values are preserved (Node's `spawn` treats `undefined` as
 * "unset" rather than the string "undefined").
 *
 * @param extras Additional key/value pairs to include in the child env.
 * @returns A fresh env object safe to pass to `spawn` / `spawnProcess`.
 */
export function buildReleaseCommandEnv(
  extras: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  };

  for (const key of ALLOWED_ENV_VARS) {
    env[key] = process.env[key];
  }

  return { ...env, ...extras };
}
