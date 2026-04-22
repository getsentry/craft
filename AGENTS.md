# AGENTS.md

This file provides guidance for AI coding assistants working with the Craft codebase.

## Package Management

- **Always use `pnpm`** for package management. Never use `npm` or `yarn`.
- Node.js version is managed by [Volta](https://volta.sh/) (currently v22.12.0).
- Install dependencies with `pnpm install --frozen-lockfile`.

## Development Commands

| Command      | Description                                 |
| ------------ | ------------------------------------------- |
| `pnpm build` | Build the project (outputs to `dist/craft`) |
| `pnpm test`  | Run tests                                   |
| `pnpm lint`  | Run ESLint                                  |
| `pnpm fix`   | Auto-fix lint issues                        |

To manually test changes:

```bash
pnpm build && ./dist/craft
```

## Code Style

- **TypeScript** is used throughout the codebase.
- **Prettier** 3.x with single quotes and no arrow parens (configured in `.prettierrc.yml`).
- **ESLint** 9.x with flat config (`eslint.config.mjs`) using `typescript-eslint`.
- Unused variables prefixed with `_` are allowed (e.g., `_unusedParam`).

## Project Structure

```
src/
├── __mocks__/          # Test mocks
├── __tests__/          # Test files (*.test.ts)
├── artifact_providers/ # Artifact provider implementations
├── commands/           # CLI command implementations
├── schemas/            # Zod schemas and TypeScript types for config
├── status_providers/   # Status provider implementations
├── targets/            # Release target implementations
├── types/              # Shared TypeScript types
├── utils/              # Utility functions
├── config.ts           # Configuration loading
├── index.ts            # CLI entry point
└── logger.ts           # Logging utilities
dist/
└── craft               # Single bundled executable (esbuild output)
```

## Testing

- Tests use **Vitest**.
- Test files are located in `src/__tests__/` and follow the `*.test.ts` naming pattern.
- Run tests with `pnpm test`.
- Use `vi.fn()`, `vi.mock()`, `vi.spyOn()` for mocking (Vitest's mock API).

## CI/CD

- Main branch is `master`.
- CI runs tests on Node.js 20 and 22.
- Craft releases itself using its own tooling (dogfooding).

## Configuration

- Project configuration lives in `.craft.yml` at the repository root.
- The configuration schema is defined in `src/schemas/`.

## Dry-Run Mode

Craft supports a `--dry-run` flag that prevents destructive operations. This is implemented via a centralized abstraction layer.

### How It Works

Instead of checking `isDryRun()` manually in every function, destructive operations are wrapped with dry-run-aware proxies:

- **Git operations**: Use `getGitClient()` from `src/utils/git.ts` or `createGitClient(directory)` for working with specific directories
- **GitHub API**: Use `getGitHubClient()` from `src/utils/githubApi.ts`
- **File writes**: Use `safeFs` from `src/utils/dryRun.ts`
- **Other actions**: Use `safeExec()` or `safeExecSync()` from `src/utils/dryRun.ts`

### ESLint Enforcement

ESLint rules prevent direct usage of raw APIs:

- `no-restricted-imports`: Blocks direct `simple-git` imports
- `no-restricted-syntax`: Blocks `new Octokit()` instantiation

If you're writing a wrapper module that needs raw access, use:

```typescript
// eslint-disable-next-line no-restricted-imports -- This is the wrapper module
import simpleGit from 'simple-git';
```

### Adding New Destructive Operations

When adding new code that performs destructive operations:

1. **Git**: Get the git client via `getGitClient()` or `createGitClient()` - mutating methods are automatically blocked
2. **GitHub API**: Get the client via `getGitHubClient()` - `create*`, `update*`, `delete*`, `upload*` methods are automatically blocked
3. **File writes**: Use `safeFs.writeFile()`, `safeFs.unlink()`, etc. instead of raw `fs` methods
4. **Other**: Wrap with `safeExec(action, description)` for custom operations

### Special Cases

Some operations need explicit `isDryRun()` checks:

- Commands with their own `--dry-run` flag (e.g., `dart pub publish --dry-run` in pubDev target)
- Operations that need to return mock data in dry-run mode
- User experience optimizations (e.g., skipping sleep timers)

<!-- This section is maintained by the coding agent via lore (https://github.com/BYK/loreai) -->

## Long-term Knowledge

### Architecture

<!-- lore:019db09e-ac9b-765d-a091-bb6bb512b987 -->

- **Craft release commands forward sanitized env, not full process.env**: Craft's pre/postReleaseCommand invocations (\`prepare.ts\` runCustomPreReleaseCommand, \`publish.ts\` runPostReleaseCommand) must NOT forward \`...process.env\` to subprocesses — that pattern lets attacker-controlled \`.craft.env\` or config inject \`LD_PRELOAD\`/\`LD_LIBRARY_PATH\` for RCE via the CI release pipeline. Use the shared allowlist helper in \`src/utils/releaseCommandEnv.ts\` which returns only {PATH, HOME, USER, GIT_COMMITTER_NAME, GIT_AUTHOR_NAME, EMAIL, GITHUB_TOKEN, CRAFT\_\*} plus per-command additions (CRAFT_NEW_VERSION/OLD_VERSION for prepare, CRAFT_RELEASED_VERSION for publish). Tests in \`prepare.test.ts\`/\`publish.test.ts\` assert LD_PRELOAD and secret env vars are stripped.

<!-- lore:019db141-686a-718a-8a22-eff2f6f60b1b -->

- **Craft spawnProcess strips dynamic-linker env from subprocess env**: PR #800: \`spawnProcess\` in \`src/utils/system.ts\` now sanitizes \`LD_PRELOAD\`/\`LD_LIBRARY_PATH\`/\`LD_AUDIT\`/\`DYLD\_\*\` from the child's env before every spawn — defence-in-depth layer on top of startup-time \`sanitizeDynamicLinkerEnv()\` (which only protects \`process.env\` of Craft itself, not subprocess inheritance if something re-injects mid-run). Helper \`sanitizeSpawnEnv(env)\` lives in new standalone \`src/utils/dynamicLinkerEnv.ts\` (no other imports) to avoid circular dep. Same \`CRAFT_ALLOW_DYNAMIC_LINKER_ENV=1\` opt-out as startup path. \`env.ts\` re-exports constants for backward compat. Complements \[\[019db09e-ac9b-765d-a091-bb6bb512b987]].

<!-- lore:019db0c1-fb9b-7f8a-bde6-050fc204afc7 -->

- **Craft target \*\_BIN env vars allow redirecting binary execution**: Craft targets honor \`\*\_BIN\` env var overrides (\`DOCKER_BIN\`, \`NPM_BIN\`, \`YARN_BIN\`, \`GEM_BIN\`, \`TWINE_BIN\`, \`MIX_BIN\`, \`NUGET_DOTNET_BIN\`, \`POWERSHELL_BIN\`, \`COCOAPODS_BIN\`, ...) to locate tool binaries. These are NOT attacker-controlled from a PR, but compose with \`preReleaseCommand\`: a malicious pre-release script could \`export NPM_BIN=/tmp/evil-npm\` before exiting, and subsequent target invocations use it. Hardening: resolve each \`\*\_BIN\` once at startup via \`resolveExecutable\`, warn if any points outside standard PATH dirs, reject relative paths.

<!-- lore:019db6da-30d7-7c0d-8ac0-a7eedc088741 -->

- **publish.yml → Craft state-file handoff via XDG_STATE_HOME**: getsentry/publish's \`publish.yml\` writes the publish-state file to \`$GITHUB\_WORKSPACE/.craft-state/craft/publish-state-\<owner>-\<repo>-\<sha1(container\_cwd)\[:12]>-\<version>.json\` and sets \`XDG\_STATE\_HOME=/github/workspace/.craft-state\` on the docker step. Craft reads from \`$XDG_STATE_HOME/craft/publish-state-\*.json\`. The container_cwd is \`/github/workspace/\_\_repo\_\_\` (root) or \`/github/workspace/\_\_repo\_\_/\<subpath>\` (monorepo) — bash case statement handles both. Outside \`\_\_repo\_\_/\` means repo contents cannot pre-populate (security). Previous dual-write compat removed in getsentry/publish#7892 after Craft 2.26.0 shipped with the new-location reader.

<!-- lore:019cb31a-14ce-7892-b22a-0327cfcebc13 -->

- **Registry target: repo_url auto-derived from git remote, not user-configurable**: \`repo_url\` in registry manifests is always set by Craft as \`https://github.com/${owner}/${repo}\`. Resolution: (1) explicit \`github: { owner, repo }\` in \`.craft.yml\` (rare), (2) fallback: auto-detect from git \`origin\` remote URL via \`git-url-parse\` library (\`git.ts:194-217\`, \`config.ts:286-316\`). Works with HTTPS and SSH remote URLs. Always overwritten on every publish — existing manifest values are replaced (\`registry.ts:417-418\`). Result is cached globally with \`Object.freeze\`. If remote isn't \`github.com\` and no explicit config exists, throws \`ConfigurationError\`. Most repos need no configuration — the git origin remote is sufficient.

<!-- lore:019cb31a-14c8-7ba9-b1c4-81b2e8bf7e85 -->

- **Registry target: urlTemplate generates artifact download URLs in manifest**: \`urlTemplate\` in the registry target config generates download URLs for release artifacts in the registry manifest's \`files\` field. Uses Mustache rendering with variables \`{{version}}\`, \`{{file}}\`, \`{{revision}}\`. Primarily useful for apps (standalone binaries) and CDN-hosted assets — SDK packages published to public registries (npm, PyPI, gem) typically don't need it. If neither \`urlTemplate\` nor \`checksums\` is configured, Craft skips adding file data entirely (warns at \`registry.ts:341-349\`). Real-world pattern: \`https://downloads.sentry-cdn.com/\<product>/{{version}}/{{file}}\`.

### Decision

<!-- lore:019db09e-acae-76ae-8813-a317c0e6f6f9 -->

- **--config-from gated behind --allow-remote-config**: Craft's \`prepare --config-from \<branch>\` fetches \`.craft.yml\` from a remote git ref and feeds it to \`loadConfigurationFromString\`, which can execute arbitrary commands via preReleaseCommand. Now gated: \`assertRemoteConfigAllowed()\` in \`src/commands/prepare.ts\` throws ConfigurationError unless \`--allow-remote-config\` (or \`CRAFT_ALLOW_REMOTE_CONFIG=1\`) is set. When opted in, a warning is logged naming the branch. Exported helper is unit-tested; full \`prepareMain\` is not (heavy mock surface).

### Gotcha

<!-- lore:019db6da-30c3-77d6-af97-f86304ab754a -->

- **Allowlist cutting GITHUB\_\* breaks user release scripts**: PR #794's release-command env allowlist was too tight — it stripped all \`GITHUB\_\*\` except \`GITHUB_TOKEN\`, breaking user scripts that read GHA context vars like \`GITHUB_RUN_ID\`, \`GITHUB_REPOSITORY\`, \`GITHUB_SHA\` (sentry-cocoa's bump.sh failed on \`unbound variable GITHUB_RUN_ID\`). Fix in #807: extend \`buildReleaseCommandEnv\` to forward any \`process.env\` key starting with \`GITHUB\_\` or \`RUNNER\_\` by prefix. Safe because \`publish.yml\` only sets \`GITHUB_TOKEN\` itself under that namespace — all other secrets use unrelated prefixes (\`NPM_TOKEN\`, \`CRATES_IO_TOKEN\`, \`AWS_SECRET_ACCESS_KEY\`, etc.). Prefix allowlist does not expand credential-leak surface.

<!-- lore:019db0c1-fb98-755c-bd6b-22134bd6d852 -->

- **Craft .craft-publish-\<version>.json state file is unauthenticated**: Craft's publish state file was \`.craft-publish-\<version>.json\` in cwd, writable by any earlier CI step or committed repo file → silent target-skip → pipeline manipulation. Fixed in PR #797 (shipped in Craft 2.26.0): moved to \`$XDG_STATE_HOME/craft/publish-state-\<owner>-\<repo>-\<sha1(cwd)\[:12]>-\<version>.json\` via \`src/utils/publishState.ts\`. Fallback when GH config unresolved: \`publish-state-\<sha256(cwd)\[:16]>-\<version>.json\`. Craft warns (doesn't read) if legacy file found in cwd. Companion publish.yml PR #7886 dual-wrote both locations; legacy write removed in #7892 after 2.26.0 shipped. \`XDG_STATE_HOME=/github/workspace/.craft-state\` set on the docker step — outside \`\_\_repo\_\_/\` so repo contents can't pre-populate. sha1(cwd) disambiguates monorepo subpaths.

<!-- lore:019db09e-aca8-7a81-b2f7-e117be50e02a -->

- **Craft .craft.env file reading removed — security hazard via LD_PRELOAD**: Craft used to hydrate \`process.env\` from \`$HOME/.craft.env\` and \`\<config-dir>/.craft.env\` via \`nvar\`. Removed because an attacker PR could add \`.craft.env\` with \`LD_PRELOAD=./preload.so\` + a malicious shared library, giving RCE in the release pipeline with access to all secrets (demo: getsentry/action-release#315). \`src/utils/env.ts\` now only exports \`warnIfCraftEnvFileExists()\` (startup warning, no file read, no env mutation) and \`checkEnvForPrerequisite\` (unchanged). \`nvar\` dep and \`src/types/nvar.ts\` were removed. Consumers must set env vars via shell/CI.

<!-- lore:019db0c1-fb90-7507-900b-896619ea120f -->

- **Craft .craft.yml discovery walks up from cwd — ancestor configs auto-load**: \`src/config.ts:findConfigFile()\` walks upward from \`cwd\` up to 1024 dirs looking for \`.craft.yml\`. Any stray \`.craft.yml\` in an ancestor (including \`$HOME\`) is loaded unconditionally and its \`preReleaseCommand\` executes. No \`--config\` flag exists to pin the path. Hardening: restrict discovery to the current git worktree root (first \`.git\` found), optionally require the file to be tracked by git, and add a \`--config \<path>\` flag that disables the walk. Complements the \`--allow-remote-config\` gate \[\[019db09e-acae-76ae-8813-a317c0e6f6f9]] and release env sanitization \[\[019db09e-ac9b-765d-a091-bb6bb512b987]].

<!-- lore:019db0c1-fb9f-719c-a903-14dc258a8cdd -->

- **Craft commitOnGitRepository uses execSync with string-interpolated tar path**: Craft commitOnGitRepository previously ran \`childProcess.execSync(\\\`tar -zxvf ${archivePath}${stripComponentsArg}\\\`)\` — shell string concatenation (fragile even if archivePath was Craft-constructed). Fixed in PR #799: replaced with \`tar.x({ file: archivePath, cwd: directory, strip: stripComponents })\` from the already-present \`node-tar\` dep. No shell, no string interpolation. Tests mock \`tar\` via \`vi.hoisted(() => ({ tarExtractMock: vi.fn() }))\` + \`vi.mock('tar', () => ({ x: tarExtractMock }))\` — required because ESM prevents \`vi.spyOn(tar, 'x')\` (throws 'Cannot redefine property').

<!-- lore:019db0c1-fb94-73b0-aeb6-513d4cb2a79b -->

- **Craft GPG TOCTOU: private key written to fixed /tmp path**: Craft GPG key import previously wrote \`GPG_PRIVATE_KEY\` to \`path.join(tmpdir(), 'private-key.asc')\` — predictable world-readable path vulnerable to TOCTOU via symlink races. Fixed in PR #798: \`src/utils/gpg.ts\` now pipes the key via stdin to \`gpg --batch --import\` using \`spawnProcess(cmd, args, opts, { stdin: privateKey })\`. Key never touches disk. \`spawnProcess\` already supports stdin piping (sets stdio\[0]='pipe', writes + ends stdin).

<!-- lore:019d9a8f-c76e-7716-b1ca-7546635fecc0 -->

- **Craft postReleaseCommand env vars pollute shared bump-version scripts**: Craft's \`runPostReleaseCommand\` sets \`CRAFT_NEW_VERSION=\<released-version>\` in the subprocess env. If a post-release script calls a shared \`bump-version.sh\` that reads \`NEW_VERSION="${CRAFT\_NEW\_VERSION:-${2:-}}"\`, the env var takes precedence over the positional arg (e.g. \`nightly\`), causing the script to set the version to the already-current release version → no diff → no commit → master stays on the release version. Fixed by replacing \`CRAFT_NEW_VERSION\`/\`CRAFT_OLD_VERSION\` with \`CRAFT_RELEASED_VERSION\` in the post-release env (\`publish.ts:563-564\`). The pre-release command (\`prepare.ts\`) still correctly uses \`CRAFT_NEW_VERSION\`. Consuming repos don't need changes unless they explicitly read \`CRAFT_NEW_VERSION\` in their post-release scripts.

<!-- lore:019db0c1-fb82-79d6-9485-77f5dcc3e924 -->

- **Craft scripts/bump-version.sh and scripts/post-release.sh auto-run from cwd**: Craft's \`prepare.ts\` (DEFAULT_BUMP_VERSION_PATH) and \`publish.ts\` (DEFAULT_POST_RELEASE_SCRIPT_PATH) silently auto-execute \`scripts/bump-version.sh\` / \`scripts/post-release.sh\` when no explicit \`preReleaseCommand\`/\`postReleaseCommand\` is set in \`.craft.yml\`. A PR that merely adds one of these files gets executed on the next \`craft prepare\`/\`publish\` with the allowlisted release env (still includes \`GITHUB_TOKEN\`) — no \`.craft.yml\` edit required. Env sanitization from PR #794 mitigates LD_PRELOAD but not the script contents themselves. Hardening: require explicit opt-in via \`preReleaseCommand\`/\`postReleaseCommand\` in \`.craft.yml\`; drop the file-exists fallback. Related: \[\[019db09e-ac9b-765d-a091-bb6bb512b987]].

<!-- lore:019db1d0-fefd-7f99-bb76-bb957dc96c38 -->

- **docker://getsentry/craft:latest tag lag vs release completion**: The \`docker://getsentry/craft:latest\` tag on DockerHub advances AFTER the GitHub release completes — there's a gap of minutes between \`release/X.Y.Z\` merging and \`:latest\` pointing to the new digest. Publish runs that trigger during this window pull the PREVIOUS version. Verify the digest mapping with \`gh api /repos/getsentry/craft/.../\` or DockerHub's tags API before assuming a publish run used the newly-released Craft. The \`image.yml\` workflow on master produces this tag; check its completion timestamp against the publish run's \`docker pull\` timestamp.

<!-- lore:019c9f57-aa0c-7a2a-8a10-911b13b48fc0 -->

- **ESM modules prevent vi.spyOn of child_process.spawnSync — use test subclass pattern**: In ESM (Vitest or Bun), you cannot \`vi.spyOn\` exports from Node built-in modules — throws 'Module namespace is not configurable'. Workaround: create a test subclass that overrides the method calling the built-in and injects controllable values. \`vi.mock\` at module level works but affects all tests in the file.

<!-- lore:019c9be1-33d1-7b6e-b107-ae7ad42a4ea4 -->

- **pnpm overrides with >= can cross major versions — use ^ to constrain**: pnpm overrides gotchas: (1) \`>=\` crosses major versions — use \`^\` to constrain within same major. (2) Version-range selectors don't reliably force re-resolution of compatible transitive deps; use blanket overrides when safe. (3) Overrides become stale — audit with \`pnpm why \<pkg>\` after dependency changes. (4) Never manually resolve pnpm-lock.yaml conflicts — \`git checkout --theirs\` then \`pnpm install\` to regenerate deterministically.

<!-- lore:019db141-686d-7689-a23e-f48c6a04a3fa -->

- **system.ts → env.ts import creates circular dep via config.ts**: Importing \`env.ts\` from \`src/utils/system.ts\` creates a circular dep: system.ts → env.ts → config.ts → artifact_providers/github.ts → (back to) system.ts (\`extractZipArchive\`). Symptom: \`BaseArtifactProvider\` evaluates as \`undefined\` at class-extension time, crashing ~8 test files. Fix: put any helper shared between system.ts and env.ts in a leaf module with no other imports (e.g. \`src/utils/dynamicLinkerEnv.ts\`). Don't import config/env-heavy modules from system.ts.

### Pattern

<!-- lore:019d8c2f-ddaf-72f0-96db-44dd54bd56b8 -->

- **Craft/Publish release flow: prepare then accept publish issue**: Craft's release flow is two-phase: (1) Run \`release.yml\` GitHub Action with version "auto" — this runs \`craft prepare\`, auto-determines version from commits, creates the \`release/X.Y.Z\` branch, and opens a publish issue on \`getsentry/publish\` repo (e.g. \`publish: getsentry/craft@2.25.3\`). (2) Add the \`accepted\` label to that publish issue to trigger the actual publish pipeline. Do NOT manually create release branches — always use the workflow. The publish issue URL is emitted in the release job logs as a \`::notice::Created publish request:\` line. The publish repo is configured via \`PUBLISH_REPO\` (defaults to \`getsentry/publish\`).

<!-- lore:019db141-6871-79b9-8a4d-25a803b4419e -->

- **Split independent security fixes into separate PRs**: User preference: when tackling multiple independent security hardening items, open one PR per item rather than a single combined PR. Each PR self-contained, independently reviewable, and revertable, with no ordering dependency. Branch naming: \`security/\<short-description>\`. Examples from this session: .craft.env / GPG stdin / node-tar / subprocess env sanitization / action pinning / publish-state move → separate PRs (#794, #797-#801) on 4+ branches off master. Companion PRs that coordinate across repos (e.g. Craft #797 + publish #7886 dual-write + publish #7892 legacy-drop) are also split by repo and sequenced deliberately.

<!-- lore:019db6da-30cf-7a01-ad6e-4930e7de03c9 -->

- **Synthetic docker-free test for released Craft binary behavior**: When Docker pull stalls (common on flaky networks), validate a released Craft binary's behavior without containers: \`gh release download \<tag> -p 'craft' -O /tmp/craft-\<ver>\`, create a minimal git repo with valid \`.craft.yml\` (needs \`statusProvider.name: github\`, not \`none\`), commit+tag, then \`CRAFT_LOG_LEVEL=Debug GITHUB_TOKEN=... craft publish --no-status-check --no-merge \<ver>\`. Pre-seed state files at paths computed from \`sha1(cwd)\[:12]\` — local cwd hash differs from container's \`/github/workspace/\_\_repo\_\_\` hash, compute fresh. Log lines like \`Found publish state file, resuming from there...\` prove the read path works without production runs.

<!-- lore:019db1d0-fef2-73d3-b17e-54512b7cb837 -->

- **Synthetic end-to-end test for Craft binary behavior without Docker**: When Docker pull fails or is slow, validate a released Craft binary's behavior by downloading the raw bundled binary from the GitHub release (\`gh release download \<tag> -p 'craft' -O /tmp/craft-\<ver>\`), creating a minimal git repo with a valid \`.craft.yml\` (need \`statusProvider.name: github\`, not \`none\`), committing + tagging, then running with \`CRAFT_LOG_LEVEL=Debug GITHUB_TOKEN=... craft publish --no-status-check --no-merge \<ver>\`. Pre-seed state files at paths Craft computes from \`sha1(cwd)\[:12]\` — the local cwd hash differs from the container's \`/github/workspace/\_\_repo\_\_\` hash, so compute it fresh. Log lines like \`Found publish state file, resuming from there...\` prove the read path works without needing a production run.

### Preference

<!-- lore:019db09e-acb5-733a-9527-b80fe9f32b0d -->

- **CHANGELOG.md is auto-managed — do not edit manually**: Craft's CHANGELOG.md is auto-generated from PR descriptions by the release pipeline. Do NOT add entries manually, even for breaking changes. The user will reject such edits. Describe breaking changes in the PR body instead; the auto-managed process surfaces them in the changelog.

<!-- lore:019db141-6874-76d9-9f8e-c5c6152e25e0 -->

- **Pin only third-party GitHub Actions — skip GitHub/Sentry owned**: User scope for \`uses:\` SHA-pinning in \`.github/workflows/\*.yml\`: pin ONLY non-GitHub, non-Sentry actions. Skip \`actions/\*\` (GitHub-owned), \`getsentry/\*\` (Sentry-owned), local \`./\` and local reusable workflows. As of PR #801, pinned third-parties are \`pnpm/action-setup\` and \`rossjrw/pr-preview-action\`. Include a \`# vX.Y.Z\` trailing comment next to each SHA for reviewer readability. Resolve SHAs via \`git ls-remote\` + \`^{}\` deref for annotated tags.
<!-- End lore-managed section -->
