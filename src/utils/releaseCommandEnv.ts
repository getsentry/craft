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
 * Exact-match environment variables passed through to user-defined
 * release commands.
 *
 * - `PATH` is needed so the shell can locate the command itself.
 * - `HOME` is needed so Git can find `~/.gitconfig` with `safe.directory`
 *   settings, which fixes "fatal: detected dubious ownership in repository"
 *   errors in CI runners.
 * - `USER`, `GIT_COMMITTER_NAME`, `GIT_AUTHOR_NAME`, and `EMAIL` help with
 *   commit operations in post-release scripts.
 */
const ALLOWED_ENV_VARS = [
  'PATH',
  'HOME',
  'USER',
  'GIT_COMMITTER_NAME',
  'GIT_AUTHOR_NAME',
  'EMAIL',
] as const;

/**
 * Prefix-match environment variables passed through to user-defined
 * release commands.
 *
 * - `GITHUB_*` — context metadata that GitHub Actions injects into every
 *   step (`GITHUB_REPOSITORY`, `GITHUB_SHA`, `GITHUB_REF`, `GITHUB_RUN_ID`,
 *   `GITHUB_ACTOR`, `GITHUB_WORKFLOW`, `GITHUB_API_URL`, ...). User release
 *   scripts commonly read these (e.g. sentry-cocoa's bump script stamps
 *   `GITHUB_RUN_ID` into a file for a follow-up step). The namespace also
 *   contains credentials — `GITHUB_TOKEN` and `GITHUB_API_TOKEN` (used as
 *   a ghcr.io / cross-repo fallback in `src/targets/docker.ts`,
 *   `src/targets/commitOnGitRepository.ts`, and `src/utils/githubApi.ts`).
 *   Both are forwarded by this prefix match. This is an intentional
 *   trade-off: a malicious `preReleaseCommand` that already has shell
 *   execution could exfiltrate whichever of the two is set, but the
 *   alternative (splitting context and credential by explicit lists)
 *   would force every consumer to proxy routine Actions metadata via
 *   `CRAFT_*`, which is the ergonomic regression that #807 exists to
 *   fix. Also note: `GITHUB_ENV`, `GITHUB_PATH`, `GITHUB_OUTPUT`, and
 *   `GITHUB_STEP_SUMMARY` point at runner files that subsequent workflow
 *   steps read — forwarding them lets a compromised release command
 *   influence later steps. The attacker already has shell exec in the
 *   same docker mount as those files, so no new primitive is granted.
 * - `RUNNER_*` — non-secret runner metadata (`RUNNER_OS`, `RUNNER_ARCH`,
 *   `RUNNER_TEMP`, ...) with the same ergonomic justification.
 *
 * These prefixes do NOT cover credential env vars named with unrelated
 * prefixes (`NPM_TOKEN`, `CRATES_IO_TOKEN`, `DOCKER_PASSWORD`,
 * `GPG_PRIVATE_KEY`, `AWS_SECRET_ACCESS_KEY`, `TWINE_PASSWORD`, ...) —
 * those remain blocked by the allowlist.
 */
const ALLOWED_ENV_VAR_PREFIXES = ['GITHUB_', 'RUNNER_'] as const;

/**
 * Builds the environment for a user-defined release command subprocess.
 *
 * The returned env contains only:
 * - every key in {@link ALLOWED_ENV_VARS} (values from `process.env`,
 *   which may be `undefined`),
 * - every key in `process.env` that starts with one of
 *   {@link ALLOWED_ENV_VAR_PREFIXES}; prefix-match keys are only
 *   included when actually present on `process.env`,
 * - any caller-supplied `extras` (e.g. `CRAFT_NEW_VERSION`), which
 *   override values from the above buckets.
 *
 * Node's `child_process.spawn` treats an `undefined` value and an
 * absent key identically — both result in the variable being unset in
 * the child. Callers inspecting the returned object via `Object.keys`
 * should be aware that exact-match keys are always present (even with
 * `undefined` values) while prefix-match keys are only present when
 * set.
 *
 * @param extras Additional key/value pairs to include in the child env.
 * @returns A fresh env object safe to pass to `spawn` / `spawnProcess`.
 */
export function buildReleaseCommandEnv(
  extras: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};

  for (const key of ALLOWED_ENV_VARS) {
    env[key] = process.env[key];
  }

  for (const key of Object.keys(process.env)) {
    if (ALLOWED_ENV_VAR_PREFIXES.some(prefix => key.startsWith(prefix))) {
      env[key] = process.env[key];
    }
  }

  return { ...env, ...extras };
}
