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
* **Craft release commands forward sanitized env, not full process.env**: Craft's pre/postReleaseCommand invocations (\`prepare.ts\` runCustomPreReleaseCommand, \`publish.ts\` runPostReleaseCommand) must NOT forward \`...process.env\` to subprocesses — that pattern lets attacker-controlled \`.craft.env\` or config inject \`LD\_PRELOAD\`/\`LD\_LIBRARY\_PATH\` for RCE via the CI release pipeline. Use the shared allowlist helper in \`src/utils/releaseCommandEnv.ts\` which returns only {PATH, HOME, USER, GIT\_COMMITTER\_NAME, GIT\_AUTHOR\_NAME, EMAIL, GITHUB\_TOKEN, CRAFT\_\*} plus per-command additions (CRAFT\_NEW\_VERSION/OLD\_VERSION for prepare, CRAFT\_RELEASED\_VERSION for publish). Tests in \`prepare.test.ts\`/\`publish.test.ts\` assert LD\_PRELOAD and secret env vars are stripped.

<!-- lore:019db141-686a-718a-8a22-eff2f6f60b1b -->
* **Craft spawnProcess strips dynamic-linker env from subprocess env**: Craft spawnProcess strips dynamic-linker env from subprocess env: \`spawnProcess\` in \`src/utils/system.ts\` sanitizes \`LD\_PRELOAD\`/\`LD\_LIBRARY\_PATH\`/\`LD\_AUDIT\`/\`DYLD\_\*\` from child env before every spawn — defence-in-depth on top of startup \`sanitizeDynamicLinkerEnv()\`. Helper \`sanitizeSpawnEnv(env)\` lives in \`src/utils/dynamicLinkerEnv.ts\` (no other imports) to avoid circular dep. Respects \`CRAFT\_ALLOW\_DYNAMIC\_LINKER\_ENV=1\` opt-out. Complements release env sanitization.

<!-- lore:019db0c1-fb9b-7f8a-bde6-050fc204afc7 -->
* **Craft target \*\_BIN env vars allow redirecting binary execution**: Craft target \*\_BIN env vars allow redirecting binary execution: Targets honor \`\*\_BIN\` env var overrides (\`DOCKER\_BIN\`, \`NPM\_BIN\`, etc.) to locate tool binaries. Not attacker-controlled from PR, but a malicious \`preReleaseCommand\` could \`export NPM\_BIN=/tmp/evil-npm\` before exiting, affecting subsequent targets. Hardening: resolve each \`\*\_BIN\` once at startup via \`resolveExecutable\`, warn if outside standard PATH, reject relative paths.

<!-- lore:019dd52d-410d-7561-b017-a5210b48081f -->
* **getsentry/action-prepare-release is the legacy predecessor of getsentry/craft action**: Two GitHub Actions wrap \`craft prepare\` for getsentry repos: (1) legacy \`getsentry/action-prepare-release\` — minimal composite action, just runs killswitch + craft prepare; (2) modern \`getsentry/craft\` (action.yml at repo root) — full composite that handles installing Craft binary (build artifact for self, or downloads from release), runs prepare, reads targets, creates/updates publish issue on \`getsentry/publish\` (or \`${owner}/publish\`) with target checkboxes preserved across re-runs. The publish issue title format is \`publish: \<owner>/\<repo>\[/\<subpath>]@\<version>\`. As of Apr 2026, ~70 getsentry repos use the new action, ~52 still use legacy, 2 are mid-migration (sentry-cocoa, streams), 8 have only \`.craft.yml\` (dormant/manual). Migration is ongoing; new repos should use \`getsentry/craft@v2\`.

<!-- lore:019db6da-30d7-7c0d-8ac0-a7eedc088741 -->
* **publish.yml → Craft state-file handoff via XDG\_STATE\_HOME**: getsentry/publish's \`publish.yml\` writes the publish-state file to \`$GITHUB\_WORKSPACE/.craft-state/craft/publish-state-\<owner>-\<repo>-\<sha1(container\_cwd)\[:12]>-\<version>.json\` and sets \`XDG\_STATE\_HOME=/github/workspace/.craft-state\` on the docker step. Craft reads from \`$XDG\_STATE\_HOME/craft/publish-state-\*.json\`. The container\_cwd is \`/github/workspace/\_\_repo\_\_\` (root) or \`/github/workspace/\_\_repo\_\_/\<subpath>\` (monorepo) — bash case statement handles both. Outside \`\_\_repo\_\_/\` means repo contents cannot pre-populate (security). Previous dual-write compat removed in getsentry/publish#7892 after Craft 2.26.0 shipped with the new-location reader.

<!-- lore:019cb31a-14ce-7892-b22a-0327cfcebc13 -->
* **Registry target: repo\_url auto-derived from git remote, not user-configurable**: \`repo\_url\` in registry manifests is always set by Craft as \`https://github.com/${owner}/${repo}\`. Resolution: (1) explicit \`github: { owner, repo }\` in \`.craft.yml\` (rare), (2) fallback: auto-detect from git \`origin\` remote URL via \`git-url-parse\` library (\`git.ts:194-217\`, \`config.ts:286-316\`). Works with HTTPS and SSH remote URLs. Always overwritten on every publish — existing manifest values are replaced (\`registry.ts:417-418\`). Result is cached globally with \`Object.freeze\`. If remote isn't \`github.com\` and no explicit config exists, throws \`ConfigurationError\`. Most repos need no configuration — the git origin remote is sufficient.

<!-- lore:019cb31a-14c8-7ba9-b1c4-81b2e8bf7e85 -->
* **Registry target: urlTemplate generates artifact download URLs in manifest**: \`urlTemplate\` in the registry target config generates download URLs for release artifacts in the registry manifest's \`files\` field. Uses Mustache rendering with variables \`{{version}}\`, \`{{file}}\`, \`{{revision}}\`. Primarily useful for apps (standalone binaries) and CDN-hosted assets — SDK packages published to public registries (npm, PyPI, gem) typically don't need it. If neither \`urlTemplate\` nor \`checksums\` is configured, Craft skips adding file data entirely (warns at \`registry.ts:341-349\`). Real-world pattern: \`https://downloads.sentry-cdn.com/\<product>/{{version}}/{{file}}\`.

### Gotcha

<!-- lore:019df837-43e4-7a80-8e4b-9954a15c1aaa -->
* **action.yml/changelog-preview.yml: shell injection via unquoted GitHub context vars**: GitHub context variables in bash scripts (\`${{ inputs.x }}\`, \`${{ github.event.y }}\`) are vulnerable to shell injection if unquoted. Fix: move to \`env:\` block at step level, then reference as \`$ENV\_VAR\`. Example: \`${{ inputs.merge\_target }}\` → \`env: { MERGE\_TARGET: ${{ inputs.merge\_target }} }\` then use \`$MERGE\_TARGET\`. Don't use escaped quotes like \`"$VAR"\` — they embed literal quote chars. Affects action.yml (killswitch, Install Craft, Craft Prepare steps) and changelog-preview.yml (Install Craft, Generate Changelog Preview steps).

<!-- lore:019db6da-30c3-77d6-af97-f86304ab754a -->
* **Allowlist cutting GITHUB\_\* breaks user release scripts**: Allowlist cutting GITHUB\_\* breaks user release scripts: PR #794's release-command env allowlist was too tight — it stripped all \`GITHUB\_\*\` except \`GITHUB\_TOKEN\`, breaking user scripts (e.g. sentry-cocoa's bump.sh) that read GHA context vars like \`GITHUB\_RUN\_ID\`, \`GITHUB\_REPOSITORY\`, \`GITHUB\_SHA\`. Fixed in PR #807: extend \`buildReleaseCommandEnv\` to forward any \`process.env\` key starting with \`GITHUB\_\` or \`RUNNER\_\` by prefix. Safe because \`publish.yml\` only sets \`GITHUB\_TOKEN\` itself — other secrets use unrelated prefixes (\`NPM\_TOKEN\`, \`CRATES\_IO\_TOKEN\`, etc.).

<!-- lore:019db0c1-fb98-755c-bd6b-22134bd6d852 -->
* **Craft .craft-publish-\<version>.json state file is unauthenticated**: Craft's publish state file was \`.craft-publish-\<version>.json\` in cwd, writable by any earlier CI step or committed repo file → silent target-skip → pipeline manipulation. Fixed in PR #797 (shipped in Craft 2.26.0): moved to \`$XDG\_STATE\_HOME/craft/publish-state-\<owner>-\<repo>-\<sha1(cwd)\[:12]>-\<version>.json\` via \`src/utils/publishState.ts\`. Fallback when GH config unresolved: \`publish-state-\<sha256(cwd)\[:16]>-\<version>.json\`. Craft warns (doesn't read) if legacy file found in cwd. Companion publish.yml PR #7886 dual-wrote both locations; legacy write removed in #7892 after 2.26.0 shipped. \`XDG\_STATE\_HOME=/github/workspace/.craft-state\` set on the docker step — outside \`\_\_repo\_\_/\` so repo contents can't pre-populate. sha1(cwd) disambiguates monorepo subpaths.

<!-- lore:019db09e-aca8-7a81-b2f7-e117be50e02a -->
* **Craft .craft.env file reading removed — security hazard via LD\_PRELOAD**: Craft used to hydrate \`process.env\` from \`$HOME/.craft.env\` and \`\<config-dir>/.craft.env\` via \`nvar\`. Removed because an attacker PR could add \`.craft.env\` with \`LD\_PRELOAD=./preload.so\` + a malicious shared library, giving RCE in the release pipeline with access to all secrets (demo: getsentry/action-release#315). \`src/utils/env.ts\` now only exports \`warnIfCraftEnvFileExists()\` (startup warning, no file read, no env mutation) and \`checkEnvForPrerequisite\` (unchanged). \`nvar\` dep and \`src/types/nvar.ts\` were removed. Consumers must set env vars via shell/CI.

<!-- lore:019db0c1-fb90-7507-900b-896619ea120f -->
* **Craft .craft.yml discovery walks up from cwd — ancestor configs auto-load**: Craft .craft.yml discovery walks up from cwd — ancestor configs auto-load: \`src/config.ts:findConfigFile()\` walks upward from \`cwd\` up to 1024 dirs looking for \`.craft.yml\`. Any stray \`.craft.yml\` in an ancestor (including \`$HOME\`) loads unconditionally and executes \`preReleaseCommand\`. No \`--config\` flag exists. Hardening: restrict discovery to git worktree root, optionally require git tracking, add \`--config \<path>\` flag to disable the walk.

<!-- lore:019db0c1-fb9f-719c-a903-14dc258a8cdd -->
* **Craft commitOnGitRepository uses execSync with string-interpolated tar path**: Craft commitOnGitRepository previously ran \`childProcess.execSync(\\\`tar -zxvf ${archivePath}${stripComponentsArg}\\\`)\` — shell string concatenation (fragile even if archivePath was Craft-constructed). Fixed in PR #799: replaced with \`tar.x({ file: archivePath, cwd: directory, strip: stripComponents })\` from the already-present \`node-tar\` dep. No shell, no string interpolation. Tests mock \`tar\` via \`vi.hoisted(() => ({ tarExtractMock: vi.fn() }))\` + \`vi.mock('tar', () => ({ x: tarExtractMock }))\` — required because ESM prevents \`vi.spyOn(tar, 'x')\` (throws 'Cannot redefine property').

<!-- lore:019db0c1-fb94-73b0-aeb6-513d4cb2a79b -->
* **Craft GPG TOCTOU: private key written to fixed /tmp path**: Craft GPG key import previously wrote \`GPG\_PRIVATE\_KEY\` to \`path.join(tmpdir(), 'private-key.asc')\` — predictable world-readable path vulnerable to TOCTOU via symlink races. Fixed in PR #798: \`src/utils/gpg.ts\` now pipes the key via stdin to \`gpg --batch --import\` using \`spawnProcess(cmd, args, opts, { stdin: privateKey })\`. Key never touches disk. \`spawnProcess\` already supports stdin piping (sets stdio\[0]='pipe', writes + ends stdin).

<!-- lore:019d9a8f-c76e-7716-b1ca-7546635fecc0 -->
* **Craft postReleaseCommand env vars pollute shared bump-version scripts**: Craft postReleaseCommand env vars pollute shared bump-version scripts: \`runPostReleaseCommand\` set \`CRAFT\_NEW\_VERSION=\<released-version>\` in subprocess env. If post-release script calls shared \`bump-version.sh\` that reads \`NEW\_VERSION="${CRAFT\_NEW\_VERSION:-${2:-}}"\`, env var takes precedence over positional arg, causing version to stay at already-current release → no diff → no commit. Fixed in \`publish.ts:563-564\`: use \`CRAFT\_RELEASED\_VERSION\` instead. Pre-release (\`prepare.ts\`) still correctly uses \`CRAFT\_NEW\_VERSION\`.

<!-- lore:019db0c1-fb82-79d6-9485-77f5dcc3e924 -->
* **Craft scripts/bump-version.sh and scripts/post-release.sh auto-run from cwd**: Craft scripts/bump-version.sh and scripts/post-release.sh auto-run from cwd: \`prepare.ts\` and \`publish.ts\` silently auto-execute \`scripts/bump-version.sh\` / \`scripts/post-release.sh\` when no explicit \`preReleaseCommand\`/\`postReleaseCommand\` in \`.craft.yml\`. A PR that merely adds one of these files gets executed on next \`craft prepare\`/\`publish\` with allowlisted release env (includes \`GITHUB\_TOKEN\`). Hardening: require explicit opt-in in \`.craft.yml\`; drop file-exists fallback.

<!-- lore:019db1d0-fefd-7f99-bb76-bb957dc96c38 -->
* **docker://getsentry/craft:latest tag lag vs release completion**: The \`docker://getsentry/craft:latest\` tag on DockerHub advances AFTER the GitHub release completes — there's a gap of minutes between \`release/X.Y.Z\` merging and \`:latest\` pointing to the new digest. Publish runs that trigger during this window pull the PREVIOUS version. Verify the digest mapping with \`gh api /repos/getsentry/craft/.../\` or DockerHub's tags API before assuming a publish run used the newly-released Craft. The \`image.yml\` workflow on master produces this tag; check its completion timestamp against the publish run's \`docker pull\` timestamp.

<!-- lore:019c9f57-aa0c-7a2a-8a10-911b13b48fc0 -->
* **ESM modules prevent vi.spyOn of child\_process.spawnSync — use test subclass pattern**: In ESM (Vitest or Bun), you cannot \`vi.spyOn\` exports from Node built-in modules — throws 'Module namespace is not configurable'. Workaround: create a test subclass that overrides the method calling the built-in and injects controllable values. \`vi.mock\` at module level works but affects all tests in the file.

<!-- lore:019c9be1-33d1-7b6e-b107-ae7ad42a4ea4 -->
* **pnpm overrides with >= can cross major versions — use ^ to constrain**: pnpm overrides with >= can cross major versions — use ^ to constrain: (1) \`>=\` crosses major versions — use \`^\` to constrain within same major. (2) Version-range selectors don't reliably force re-resolution of compatible transitive deps; use blanket overrides when safe. (3) Overrides become stale — audit with \`pnpm why \<pkg>\` after dependency changes. (4) Never manually resolve pnpm-lock.yaml conflicts — \`git checkout --theirs\` then \`pnpm install\` to regenerate deterministically.

<!-- lore:019db141-686d-7689-a23e-f48c6a04a3fa -->
* **system.ts → env.ts import creates circular dep via config.ts**: system.ts → env.ts import creates circular dep via config.ts: Importing \`env.ts\` from \`src/utils/system.ts\` creates circular dep: system.ts → env.ts → config.ts → artifact\_providers/github.ts → system.ts. Symptom: \`BaseArtifactProvider\` is \`undefined\` at class-extension time, crashing ~8 test files. Fix: put helpers shared between system.ts and env.ts in leaf module with no other imports (e.g. \`src/utils/dynamicLinkerEnv.ts\`). Don't import config/env-heavy modules from system.ts.

### Pattern

<!-- lore:019d8c2f-ddaf-72f0-96db-44dd54bd56b8 -->
* **Craft/Publish release flow: prepare then accept publish issue**: Craft's release flow is two-phase: (1) Run \`release.yml\` GitHub Action with version "auto" — this runs \`craft prepare\`, auto-determines version from commits, creates the \`release/X.Y.Z\` branch, and opens a publish issue on \`getsentry/publish\` repo (e.g. \`publish: getsentry/craft@2.25.3\`). (2) Add the \`accepted\` label to that publish issue to trigger the actual publish pipeline. Do NOT manually create release branches — always use the workflow. The publish issue URL is emitted in the release job logs as a \`::notice::Created publish request:\` line. The publish repo is configured via \`PUBLISH\_REPO\` (defaults to \`getsentry/publish\`).

<!-- lore:019db141-6871-79b9-8a4d-25a803b4419e -->
* **Split independent security fixes into separate PRs**: User preference: when tackling multiple independent security hardening items, open one PR per item rather than a single combined PR. Each PR self-contained, independently reviewable, and revertable, with no ordering dependency. Branch naming: \`security/\<short-description>\`. Examples from this session: .craft.env / GPG stdin / node-tar / subprocess env sanitization / action pinning / publish-state move → separate PRs (#794, #797-#801) on 4+ branches off master. Companion PRs that coordinate across repos (e.g. Craft #797 + publish #7886 dual-write + publish #7892 legacy-drop) are also split by repo and sequenced deliberately.

<!-- lore:019db1d0-fef2-73d3-b17e-54512b7cb837 -->
* **Synthetic end-to-end test for Craft binary behavior without Docker**: Synthetic end-to-end test for Craft binary behavior without Docker: Download bundled binary from release (\`gh release download \<tag> -p 'craft'\`), create minimal git repo with \`.craft.yml\` (need \`statusProvider.name: github\`), commit+tag, then run with \`CRAFT\_LOG\_LEVEL=Debug GITHUB\_TOKEN=... craft publish --no-status-check --no-merge \<ver>\`. Pre-seed state files using \`sha1(cwd)\[:12]\` (differs from container's \`/github/workspace/\_\_repo\_\_\` hash). Log lines like \`Found publish state file, resuming from there...\` prove the read path works without production runs.

### Preference

<!-- lore:019db09e-acb5-733a-9527-b80fe9f32b0d -->
* **CHANGELOG.md is auto-managed — do not edit manually**: Craft's CHANGELOG.md is auto-generated from PR descriptions by the release pipeline. Do NOT add entries manually, even for breaking changes. The user will reject such edits. Describe breaking changes in the PR body instead; the auto-managed process surfaces them in the changelog.

<!-- lore:019db141-6874-76d9-9f8e-c5c6152e25e0 -->
* **Pin only third-party GitHub Actions — skip GitHub/Sentry owned**: User scope for \`uses:\` SHA-pinning in \`.github/workflows/\*.yml\`: pin ONLY non-GitHub, non-Sentry actions. Skip \`actions/\*\` (GitHub-owned), \`getsentry/\*\` (Sentry-owned), local \`./\` and local reusable workflows. As of PR #801, pinned third-parties are \`pnpm/action-setup\` and \`rossjrw/pr-preview-action\`. Include a \`# vX.Y.Z\` trailing comment next to each SHA for reviewer readability. Resolve SHAs via \`git ls-remote\` + \`^{}\` deref for annotated tags.
<!-- End lore-managed section -->
