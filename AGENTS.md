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
* **Craft release commands forward sanitized env, not full process.env**: Craft release commands forward sanitized env, not full process.env: Pre/postReleaseCommand invocations must NOT forward \`...process.env\` to subprocesses — this allows attacker-controlled \`.craft.env\` or config to inject \`LD\_PRELOAD\`/\`LD\_LIBRARY\_PATH\` for RCE via CI. Use the allowlist helper in \`src/utils/releaseCommandEnv.ts\` which returns only {PATH, HOME, USER, GIT\_COMMITTER\_NAME, GIT\_AUTHOR\_NAME, EMAIL, GITHUB\_TOKEN, CRAFT\_\*} plus per-command additions (CRAFT\_NEW\_VERSION/OLD\_VERSION for prepare, CRAFT\_RELEASED\_VERSION for publish). Also strips dynamic-linker env (\`LD\_PRELOAD\`, \`LD\_LIBRARY\_PATH\`, \`LD\_AUDIT\`, \`DYLD\_\*\`) via \`sanitizeSpawnEnv()\` in \`src/utils/dynamicLinkerEnv.ts\` as defence-in-depth.

<!-- lore:019db0c1-fb9b-7f8a-bde6-050fc204afc7 -->
* **Craft target \*\_BIN env vars allow redirecting binary execution**: Craft target \*\_BIN env vars allow redirecting binary execution: Targets honor \`\*\_BIN\` env var overrides (\`DOCKER\_BIN\`, \`NPM\_BIN\`, etc.) to locate tool binaries. A malicious \`preReleaseCommand\` could \`export NPM\_BIN=/tmp/evil-npm\` before exiting, affecting subsequent targets. Hardening: resolve each \`\*\_BIN\` once at startup via \`resolveExecutable\`, warn if outside standard PATH, reject relative paths.

<!-- lore:019dd52d-410d-7561-b017-a5210b48081f -->
* **getsentry/action-prepare-release is the legacy predecessor of getsentry/craft action**: getsentry/action-prepare-release is the legacy predecessor of getsentry/craft action: Two GitHub Actions wrap \`craft prepare\`: (1) legacy \`getsentry/action-prepare-release\` — minimal, just killswitch + prepare; (2) modern \`getsentry/craft\` (action.yml at repo root) — installs Craft binary, runs prepare, reads targets, creates/updates publish issue on \`getsentry/publish\` with checkboxes preserved across re-runs. Publish issue title: \`publish: \<owner>/\<repo>\[/\<subpath>]@\<version>\`. As of Apr 2026, ~70 getsentry repos use new action, ~52 still use legacy, migration ongoing. New repos should use \`getsentry/craft@v2\`.

<!-- lore:019cb31a-14ce-7892-b22a-0327cfcebc13 -->
* **Registry target: repo\_url auto-derived from git remote, not user-configurable**: \`repo\_url\` in registry manifests is always set by Craft as \`https://github.com/${owner}/${repo}\`. Resolution: (1) explicit \`github: { owner, repo }\` in \`.craft.yml\` (rare), (2) fallback: auto-detect from git \`origin\` remote URL via \`git-url-parse\` library (\`git.ts:194-217\`, \`config.ts:286-316\`). Works with HTTPS and SSH remote URLs. Always overwritten on every publish — existing manifest values are replaced (\`registry.ts:417-418\`). Result is cached globally with \`Object.freeze\`. If remote isn't \`github.com\` and no explicit config exists, throws \`ConfigurationError\`. Most repos need no configuration — the git origin remote is sufficient.

<!-- lore:019cb31a-14c8-7ba9-b1c4-81b2e8bf7e85 -->
* **Registry target: urlTemplate generates artifact download URLs in manifest**: \`urlTemplate\` in the registry target config generates download URLs for release artifacts in the registry manifest's \`files\` field. Uses Mustache rendering with variables \`{{version}}\`, \`{{file}}\`, \`{{revision}}\`. Primarily useful for apps (standalone binaries) and CDN-hosted assets — SDK packages published to public registries (npm, PyPI, gem) typically don't need it. If neither \`urlTemplate\` nor \`checksums\` is configured, Craft skips adding file data entirely (warns at \`registry.ts:341-349\`). Real-world pattern: \`https://downloads.sentry-cdn.com/\<product>/{{version}}/{{file}}\`.

### Gotcha

<!-- lore:019df837-43e4-7a80-8e4b-9954a15c1aaa -->
* **action.yml/changelog-preview.yml: shell injection via unquoted GitHub context vars**: action.yml/changelog-preview.yml: shell injection via unquoted GitHub context vars: GitHub context variables in bash scripts (\`${{ inputs.x }}\`, \`${{ github.event.y }}\`) are vulnerable to shell injection if unquoted. Fix: move to \`env:\` block at step level, then reference as \`$ENV\_VAR\`. Example: \`${{ inputs.merge\_target }}\` → \`env: { MERGE\_TARGET: ${{ inputs.merge\_target }} }\` then use \`$MERGE\_TARGET\`. Don't use escaped quotes — they embed literal chars. Affects action.yml and changelog-preview.yml.

<!-- lore:019df871-87d5-739a-bd83-82b92aae8d8a -->
* **Bash array expansion required for safe shell argument passing in actions**: GitHub Actions bash scripts must use bash arrays to safely pass user-controlled arguments to executables. String concatenation with escaped quotes (e.g., \`CRAFT\_ARGS="--config-from \\"$VAR\\""\`) embeds literal quote characters in the argument, causing the downstream command to receive \`"value"\` instead of \`value\`. Use arrays instead: \`CRAFT\_ARGS=(--config-from "$VAR")\` then expand with \`"${CRAFT\_ARGS\[@]}"\`. Handles spaces, special chars, and ensures correct quoting at shell expansion time. Applied in action.yml PR #811 for \`craft prepare\` invocation.

<!-- lore:019db0c1-fb98-755c-bd6b-22134bd6d852 -->
* **Craft .craft-publish-\<version>.json state file is unauthenticated**: Craft .craft-publish-\<version>.json state file is unauthenticated: The publish state file was \`.craft-publish-\<version>.json\` in cwd, writable by any earlier CI step → silent target-skip → pipeline manipulation. Fixed in PR #797 (v2.26.0): moved to \`$XDG\_STATE\_HOME/craft/publish-state-\<owner>-\<repo>-\<sha1(cwd)\[:12]>-\<version>.json\` via \`src/utils/publishState.ts\`. \`XDG\_STATE\_HOME=/github/workspace/.craft-state\` set on docker step (outside \`\_\_repo\_\_/\` so repo can't pre-populate). Fallback when GH config unresolved: \`publish-state-\<sha256(cwd)\[:16]>-\<version>.json\`.

<!-- lore:019db09e-aca8-7a81-b2f7-e117be50e02a -->
* **Craft .craft.env file reading removed — security hazard via LD\_PRELOAD**: Craft .craft.env file reading removed — security hazard via LD\_PRELOAD: Craft used to hydrate \`process.env\` from \`$HOME/.craft.env\` and \`\<config-dir>/.craft.env\`, allowing attacker PRs to inject \`LD\_PRELOAD=./preload.so\` for RCE with full secret access. Removed entirely. \`src/utils/env.ts\` now only exports \`warnIfCraftEnvFileExists()\` (startup warning) and \`checkEnvForPrerequisite\`. Consumers must set env vars via shell/CI.

<!-- lore:019db0c1-fb90-7507-900b-896619ea120f -->
* **Craft .craft.yml discovery walks up from cwd — ancestor configs auto-load**: Craft .craft.yml discovery walks up from cwd — ancestor configs auto-load: \`src/config.ts:findConfigFile()\` walks upward up to 1024 dirs looking for \`.craft.yml\`. Any stray \`.craft.yml\` in an ancestor (including \`$HOME\`) loads unconditionally and executes \`preReleaseCommand\`. No \`--config\` flag exists. Hardening: restrict discovery to git worktree root, optionally require git tracking, add \`--config \<path>\` flag to disable the walk.

<!-- lore:019db0c1-fb9f-719c-a903-14dc258a8cdd -->
* **Craft commitOnGitRepository uses execSync with string-interpolated tar path**: Craft commitOnGitRepository uses execSync with string-interpolated tar path: Previously ran \`childProcess.execSync(\\\`tar -zxvf ${archivePath}${stripComponentsArg}\\\`)\` — shell string concatenation vulnerable to injection. Fixed in PR #799: replaced with \`tar.x({ file: archivePath, cwd: directory, strip: stripComponents })\` from \`node-tar\` dep. No shell, no interpolation.

<!-- lore:019db0c1-fb94-73b0-aeb6-513d4cb2a79b -->
* **Craft GPG TOCTOU: private key written to fixed /tmp path**: Craft GPG TOCTOU: private key written to fixed /tmp path: Craft GPG key import previously wrote \`GPG\_PRIVATE\_KEY\` to \`path.join(tmpdir(), 'private-key.asc')\` — predictable world-readable path vulnerable to TOCTOU via symlink races. Fixed in PR #798: \`src/utils/gpg.ts\` now pipes the key via stdin to \`gpg --batch --import\` using \`spawnProcess()\`. Key never touches disk.

<!-- lore:019d9a8f-c76e-7716-b1ca-7546635fecc0 -->
* **Craft postReleaseCommand env vars pollute shared bump-version scripts**: Craft postReleaseCommand env vars pollute shared bump-version scripts: \`runPostReleaseCommand\` set \`CRAFT\_NEW\_VERSION=\<released-version>\` in subprocess env. If post-release script calls shared \`bump-version.sh\` that reads \`NEW\_VERSION="${CRAFT\_NEW\_VERSION:-${2:-}}"\`, env var takes precedence over positional arg, causing version to stay at already-current release → no diff → no commit. Fixed in \`publish.ts:563-564\`: use \`CRAFT\_RELEASED\_VERSION\` instead (prepare.ts correctly uses \`CRAFT\_NEW\_VERSION\`).

<!-- lore:019db0c1-fb82-79d6-9485-77f5dcc3e924 -->
* **Craft scripts/bump-version.sh and scripts/post-release.sh auto-run from cwd**: Craft scripts/bump-version.sh and scripts/post-release.sh auto-run from cwd: \`prepare.ts\` and \`publish.ts\` silently auto-execute \`scripts/bump-version.sh\` / \`scripts/post-release.sh\` when no explicit \`preReleaseCommand\`/\`postReleaseCommand\` in \`.craft.yml\`. A PR that merely adds one of these files gets executed on next \`craft prepare\`/\`publish\` with allowlisted release env (includes \`GITHUB\_TOKEN\`). Hardening: require explicit opt-in in \`.craft.yml\`; drop file-exists fallback.

<!-- lore:019c9f57-aa0c-7a2a-8a10-911b13b48fc0 -->
* **ESM modules prevent vi.spyOn of child\_process.spawnSync — use test subclass pattern**: ESM modules prevent vi.spyOn of child\_process.spawnSync — use test subclass pattern: In ESM (Vitest or Bun), you cannot \`vi.spyOn\` exports from Node built-in modules — throws 'Module namespace is not configurable'. Workaround: create a test subclass that overrides the method and injects controllable values, or use module-level \`vi.mock()\` (affects all tests in file).

<!-- lore:019db141-686d-7689-a23e-f48c6a04a3fa -->
* **system.ts → env.ts import creates circular dep via config.ts**: system.ts → env.ts import creates circular dep via config.ts: Importing \`env.ts\` from \`src/utils/system.ts\` creates circular dep: system.ts → env.ts → config.ts → artifact\_providers/github.ts → system.ts. Symptom: \`BaseArtifactProvider\` is \`undefined\` at class-extension time. Fix: put helpers shared between system.ts and env.ts in leaf module with no other imports (e.g. \`src/utils/dynamicLinkerEnv.ts\`). Don't import config/env-heavy modules from system.ts.

### Pattern

<!-- lore:019d8c2f-ddaf-72f0-96db-44dd54bd56b8 -->
* **Craft/Publish release flow: prepare then accept publish issue**: Craft's release flow is two-phase: (1) Run \`release.yml\` GitHub Action with version "auto" — this runs \`craft prepare\`, auto-determines version from commits, creates the \`release/X.Y.Z\` branch, and opens a publish issue on \`getsentry/publish\` repo (e.g. \`publish: getsentry/craft@2.25.3\`). (2) Add the \`accepted\` label to that publish issue to trigger the actual publish pipeline. Do NOT manually create release branches — always use the workflow. The publish issue URL is emitted in the release job logs as a \`::notice::Created publish request:\` line. The publish repo is configured via \`PUBLISH\_REPO\` (defaults to \`getsentry/publish\`).

<!-- lore:019db1d0-fef2-73d3-b17e-54512b7cb837 -->
* **Synthetic end-to-end test for Craft binary behavior without Docker**: Synthetic end-to-end test for Craft binary behavior without Docker: Download bundled binary from release (\`gh release download \<tag> -p 'craft'\`), create minimal git repo with \`.craft.yml\` (need \`statusProvider.name: github\`), commit+tag, then run with \`CRAFT\_LOG\_LEVEL=Debug GITHUB\_TOKEN=... craft publish --no-status-check --no-merge \<ver>\`. Pre-seed state files using \`sha1(cwd)\[:12]\` (differs from container's \`/github/workspace/\_\_repo\_\_\` hash). Log lines like \`Found publish state file, resuming from there...\` prove the read path works without production runs.

### Preference

<!-- lore:019db09e-acb5-733a-9527-b80fe9f32b0d -->
* **CHANGELOG.md is auto-managed — do not edit manually**: Craft's CHANGELOG.md is auto-generated from PR descriptions by the release pipeline. Do NOT add entries manually, even for breaking changes. The user will reject such edits. Describe breaking changes in the PR body instead; the auto-managed process surfaces them in the changelog.

<!-- lore:019db141-6874-76d9-9f8e-c5c6152e25e0 -->
* **Pin only third-party GitHub Actions — skip GitHub/Sentry owned**: User scope for \`uses:\` SHA-pinning in \`.github/workflows/\*.yml\`: pin ONLY non-GitHub, non-Sentry actions. Skip \`actions/\*\` (GitHub-owned), \`getsentry/\*\` (Sentry-owned), local \`./\` and local reusable workflows. As of PR #801, pinned third-parties are \`pnpm/action-setup\` and \`rossjrw/pr-preview-action\`. Include a \`# vX.Y.Z\` trailing comment next to each SHA for reviewer readability. Resolve SHAs via \`git ls-remote\` + \`^{}\` deref for annotated tags.
<!-- End lore-managed section -->
