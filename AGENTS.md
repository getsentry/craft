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

<!-- This section is maintained by the coding agent via lore (https://github.com/BYK/opencode-lore) -->
## Long-term Knowledge

### Architecture

<!-- lore:019d4479-fd88-7a7d-96b1-2a6b668dfc45 -->
* **Craft post-publish merge is non-blocking housekeeping**: After all publish targets complete, \`handleReleaseBranch()\` in \`src/commands/publish.ts\` merges the release branch back into the default branch and deletes it. This is a housekeeping step — failures are caught, reported to Sentry via \`captureException\`, and logged as warnings without failing the command. The merge uses \`--no-ff\` with the default (ort) strategy first, then retries with \`-s resolve\` if conflicts occur (handles criss-cross ambiguities in files like CHANGELOG.md). An \`isAuthError()\` helper distinguishes authentication failures (expired tokens) from merge conflicts to provide targeted diagnostics.

<!-- lore:019db1ee-c08f-7a26-b68a-dea0d9370615 -->
* **Craft static bumpVersion pattern across targets**: Craft auto version bumping is opt-in per target class via a static \`bumpVersion(rootDir, newVersion): Promise\<boolean>\` method. \`src/utils/versionBump.ts\` discovers which target classes have it via \`hasBumpVersion()\`, calls each unique class once in config order (not per-target-instance), and records bumpable vs skipped. Returning \`false\` means no-op (e.g., no package.json found); throwing fails the whole release with context. Targets implementing it today: npm, pypi, crates, gem, pubDev, hex, nuget. \`github\` target intentionally has none. Tests live in \`src/\_\_tests\_\_/versionBump.test.ts\` with a hoisted \`mockSpawnProcess\` + \`mockHasExecutable\` pattern that also stubs \`runWithExecutable\` to re-invoke the mocks (since real \`runWithExecutable\` internally calls unmocked \`hasExecutable\`).

<!-- lore:019daf66-fed2-7f4f-be92-0db09b675d66 -->
* **getsentry/publish poller: active-polling via self-dispatch, cron as fallback**: GitHub Actions \`\*/5\` cron drifts to 30-40 min under load, stalling releases with fast CI. \`ci-poller.yml\` uses self-dispatch: when pending issues remain, it \`gh workflow run\`s itself (cap 60 attempts ~30min). Concurrency group \`ci-status-poller\` with \`cancel-in-progress: false\` queues runs — GHA startup gives ~30-60s between checks. Chain starts via \`waiting-for-ci\` job in \`publish.yml\` when \`accepted\` label is added. Cron is safety net (also skipped when \`CI\_POLLER\_HAS\_PENDING == 'false'\`). Zero idle cost — no chain running unless human action occurred. Self-dispatch step must guard on \`steps.token.outcome == 'success'\` and \`steps.remaining.outcome == 'success'\` to avoid dispatching with empty token.

<!-- lore:019d7bfb-6e1b-7ac1-b55c-09ff4b50d4a1 -->
* **Publish repo event-driven CI gate replaces polling in craft publish**: The \`getsentry/publish\` repo uses a label-based state machine instead of having \`craft publish\` poll CI status for up to 60 minutes. Labels: \`ci-pending\` (set at issue creation), \`ci-ready\` (set by poller or dispatch when CI passes). The \`publish.yml\` job requires \`accepted && !ci-pending\`. A \`ci-poller.yml\` cron (every 5 min) checks CI via GitHub API and swaps labels when ready. A \`ci-ready.yml\` handles \`repository\_dispatch\` for repos that signal directly. This eliminates wasted runner time from idle polling and preserves the GitHub App token's 1-hour lifetime for the actual publish step.

### Gotcha

<!-- lore:019d8634-1a57-7ca9-985f-915388690fda -->
* **actions/create-github-app-token v3 deprecated app-id input**: \*\*actions/create-github-app-token v3 required + app-id deprecated\*\*: v3 is needed for Node.js 24 runners (v2 uses Node 20, deprecated). v3 also deprecated the \`app-id\` input in favor of \`client-id\`. When the input references a variable named \`\*\_APP\_ID\`, the variable value may already be a client ID (check \`vars.SENTRY\_INTERNAL\_APP\_ID\` vs \`vars.SENTRY\_RELEASE\_BOT\_CLIENT\_ID\`). Replace both the action version and the input name. Affects all workflow files using the action.

<!-- lore:019daf66-fef3-7f51-a7f2-07276b8d300e -->
* **auto-approve race: can fire before ci-pending.yml adds its label**: \*\*Resolved in getsentry/publish PR #7881\*\*: Eliminated the race by restructuring the label flow — \`ci-pending\` is now added by \`waiting-for-ci\` in \`publish.yml\` only AFTER \`accepted\` is present, not by a separate \`ci-pending.yml\` on \`issues:opened\`. The \`ci-pending.yml\` workflow was deleted. New flow: craft creates issue → (auto-approve or human) adds \`accepted\` → \`waiting-for-ci\` job adds \`ci-pending\`, comments, and triggers the poller → poller swaps to \`ci-ready\` when CI passes → \`publish.yml\` fires. The publish gate also requires \`label == accepted || label == ci-ready\`, so publish can never fire from the initial \`accepted\` label event alone — it must wait for the poller's \`ci-ready\` transition. This closes the race regardless of label ordering.

<!-- lore:019db1ee-c08c-739e-879e-d958e5d9f1a1 -->
* **bun pm pack reads workspace versions from bun.lock, not package.json**: \`bun pm pack\` rewrites \`workspace:\*\` specifiers to concrete versions at pack time, reading them from \`bun.lock\` — NOT from the workspace \`package.json\`. Neither \`npm version\` nor \`bun install\` (even \`--lockfile-only\`) updates the lockfile's workspace \`version\` entries once present; only \`rm bun.lock && bun install --lockfile-only\` refreshes them. If craft bumps package.json but leaves bun.lock stale, published tarballs ship with \`dependencies\` pointing at an old never-published version, causing \`ETARGET\` on install. Fix in NpmTarget.bumpVersion: after successful bumps, regex-patch bun.lock — find each workspace's path-relative key (normalize \`\\\` → \`/\` for Windows, escape regex chars) and replace the first \`"version": "..."\` line in that block. Use \`safeFs.writeFileSync\` for dry-run safety. Idempotent; no bun binary required.

<!-- lore:019d9acf-8039-7fc0-b677-83fe5ea32a20 -->
* **CI poller needs release-bot token for private repo CI status checks**: The \`getsentry/publish\` CI poller's cross-repo API calls (commit status, check suites, git refs) require the \`sentry-release-bot\` app token with \`owner: getsentry\` scope — not the \`sentry-internal-app\` token. The internal app isn't installed on all getsentry repos (e.g. \`sentry-xbox\`, \`sentry-playstation\`, \`sentry-switch\`, \`service-registry\`), causing 404s on all CI status API calls. Combined with the \`gh api --jq\` stdout error leak, this silently leaves issues stuck in \`ci-pending\` indefinitely. Fix (PR #7843): added a separate \`release-bot-token\` step and a \`gh\_api\_release\` helper that uses \`GH\_TOKEN="$RELEASE\_TOKEN"\` for all cross-repo calls.

<!-- lore:019d4479-fd93-7328-a4b5-f9405e4aad8b -->
* **GitHub App tokens expire after 1 hour — breaks long-running CI publishes**: GitHub App installation tokens expire after 1 hour (non-configurable). For publish jobs exceeding this (e.g., sentry-native's ~1h 23m symbol upload), the token expires before Craft's post-publish \`git push\` for the release branch merge. Git fails with \`could not read Username for 'https://github.com': No such device or address\` — which looks like a credential config issue but is actually token expiration. No code change in Craft alone can fix this — the \`GITHUB\_TOKEN\` env var, git \`http.extraheader\`, and Octokit all use the same expired token. The real fix requires the CI workflow (\`getsentry/publish\`) to generate a fresh token after the Docker container exits, before the merge step.

<!-- lore:019db1ee-c081-7071-b851-23bfbc888bd1 -->
* **npm version --workspaces fails on workspace:\* deps but still bumps files**: \`npm version \<v> --workspaces --include-workspace-root\` on a monorepo with \`"workspace:\*"\` deps successfully writes the new version to every package.json, then exits non-zero with \`EUNSUPPORTEDPROTOCOL\` when validating dep URLs. Craft's \`NpmTarget.bumpVersion\` (src/targets/npm.ts:312) treats the exit code as failure and falls back to per-package bumping, which hits the same validator. Fix: on spawn failure, post-check observable state — read every package.json and if all show \`version === newVersion\`, warn (citing npm/cli#8845) and proceed. Genuine failures (bad version, perm errors) still throw because files weren't bumped. Apply the same post-check per-package inside \`bumpWorkspacePackagesIndividually\`. Guard with \`isDryRun()\` since \`spawnProcess\` no-ops in dry-run and files won't be touched.

<!-- lore:019d4479-fd9a-7a97-931f-8f9a18e5752e -->
* **prepare-dry-run e2e tests fail without EDITOR in dumb terminals**: The 7 tests in \`src/\_\_tests\_\_/prepare-dry-run.e2e.test.ts\` fail in environments where \`TERM=dumb\` and \`EDITOR\` is unset (e.g., inside agent shells or minimal CI containers). The error is \`Terminal is dumb, but EDITOR unset\` from git commit. This is a pre-existing environment issue, not a code defect. These tests pass in normal CI (Node.js 20/22 runners) where terminal capabilities are available.

<!-- lore:019daf66-fee9-7897-86e9-69d4c4e0c582 -->
* **Publish issue title monorepo suffix breaks owner/repo parsing**: Craft titles like \`publish: getsentry/relay/py@0.9.26\` have a subdirectory path suffix. Naive \`sed 's/^publish: \\(.\*\\)@.\*/\1/p'\` extracts \`getsentry/relay/py\` — causes 404 on every GitHub API call (\`repos/getsentry/relay/py/...\` isn't a valid repo). Fix: match only first two path segments: \`sed -n 's|^publish: \\(\[^/]\*/\[^/@]\*\\).\*@.\*|\1|p'\`. Applies to any workflow parsing publish issue titles (ci-poller.yml, auto-approve.yml, craft-action.yml's request-publish step).

<!-- lore:019db1ee-c097-7368-b790-eb49552aa1b2 -->
* **spawnProcess no-ops in dry-run — breaks post-check logic**: \`src/utils/system.ts\` \`spawnProcess\` returns \`undefined\` immediately in dry-run mode (unless \`enableInDryRunMode\` or worktree mode is set) — it never actually spawns the child. Any logic that relies on observable side effects (files written, state changed) after a spawn will see unchanged state in dry-run. Example trap: post-checking package.json \`version\` after \`npm version\` to detect successful-but-errored bumps would incorrectly trigger fallback paths in dry-run because the spawn is skipped and files stay stale. Mitigation: guard post-check / fallback logic with \`isDryRun()\` and short-circuit to the existing dry-run success behavior. File writes don't have this problem if routed through \`safeFs.writeFileSync\` which handles dry-run natively.

### Pattern

<!-- lore:019d867b-7617-77ff-a3e3-25f9e7548b29 -->
* **CI poller variable gate with dedicated app token in getsentry/publish**: \*\*CI poller variable gate with dedicated app token in getsentry/publish\*\*: The \`ci-poller.yml\` cron uses repo variable \`CI\_POLLER\_HAS\_PENDING\` as a fast gate — \`'true'\` runs, otherwise skips. \`workflow\_dispatch\` bypasses the gate. \*\*Self-dispatch for fast re-checking\*\*: when pending issues remain, the poller dispatches itself (up to 60 attempts, ~30 min cap) for ~30-60s intervals instead of relying on unreliable cron. \*\*Two tokens required\*\*: (1) \`sentry-release-bot\` (\`SENTRY\_RELEASE\_BOT\_CLIENT\_ID\`/\`SENTRY\_RELEASE\_BOT\_PRIVATE\_KEY\` with \`owner: getsentry\`) for cross-repo API calls (CI status, check suites, git refs) since sentry-internal-app isn't installed on all repos. (2) \`CI\_POLLER\_APP\` token for writing repo variables. \`gh issue list/edit/comment\` uses sentry-internal-app token so label changes trigger \`publish.yml\`. Key: cleanup steps use \`if: always()\`; disable steps guard on \`steps.poller-token.outcome == 'success'\`.

<!-- lore:019daf66-5dbc-729e-89a3-a35ec63707bf -->
* **Craft action.yml opt-in ci\_ready input + signal-ready composite action**: In getsentry/craft, the \`ci\_ready: 'true'\` input on \`action.yml\` makes \`craft prepare\` add a \`ci-pending\` label at issue creation (atomic with \`gh issue create --label\`), opting the repo into event-driven publishing. A separate composite action \`signal-ready/action.yml\` lets target repo CI send a \`repository\_dispatch\` event of type \`ci-ready\` with \`{repo, version, sha}\` payload to the publish repo when CI passes. The publish repo's \`ci-ready.yml\` handler finds the issue by exact title match (\`publish: {repo}@{version}\`), verifies \`ci-pending\` is present, swaps labels. Auth: the dispatch sender needs a token with write access to the publish repo (sentry-release-bot app token, not \`GITHUB\_TOKEN\`).

<!-- lore:019d4479-fd97-764e-a7ec-0d32360b0f16 -->
* **Craft Docker container auth: credentials come from volume-mounted git config**: When Craft runs inside Docker in CI (via \`getsentry/craft:latest\`), git authentication comes from \`actions/checkout\`'s \`http.extraheader\` in the local \`.git/config\`, which is volume-mounted into the container at \`/github/workspace\`. The container sets \`HOME=/root\`, so global git config from the host runner isn't available. The \`GITHUB\_TOKEN\` env var is passed separately. Craft's \`handleReleaseBranch()\` doesn't set up its own auth — it relies on whatever git config is present. Other targets (registry, commitOnGitRepository) explicitly inject tokens into clone URLs via \`GitHubRemote.getRemoteStringWithAuth()\` or URL manipulation.

<!-- lore:019db1ee-c093-7663-8c7d-37c07fda211b -->
* **Craft workspace discovery supports npm/yarn/pnpm uniformly**: \`src/utils/workspaces.ts\` \`discoverWorkspaces(rootDir)\` returns \`{type: 'npm'|'yarn'|'pnpm'|'none', packages: WorkspacePackage\[]}\`. Tries pnpm-workspace.yaml first (more specific), then package.json \`workspaces\` field (array or \`{packages: \[]}\` object form). npm vs yarn is distinguished by presence of \`yarn.lock\`. Each \`WorkspacePackage\` carries \`name\`, absolute \`location\`, \`private\`, \`hasPublicAccess\` (publishConfig.access === 'public'), and \`workspaceDependencies\` (deps that reference other workspace packages by name — across dependencies/peer/optional, not dev). \`NpmTarget.expand\` uses this to auto-generate per-package target configs, filters private packages, validates public→private deps, and topologically sorts via \`topologicalSortPackages\` (depth-based, detects cycles). Artifact filenames generated via \`packageNameToArtifactPattern\` or a user \`artifactTemplate\` with \`{{name}}\`/\`{{simpleName}}\`/\`{{version}}\`.

<!-- lore:019daf66-fed6-7031-9a7c-b94791a71647 -->
* **getsentry/publish: label-based state machine for publish gating**: getsentry/publish label state machine (post-PR #7881 + retry-race fix): \`accepted\` (human/auto-approve, added first), \`ci-pending\` (added by \`waiting-for-ci\` in publish.yml AFTER \`accepted\`), \`ci-ready\` (added by poller when CI passes), \`ci-failed\` (added by poller on failure, also removes \`accepted\`). \*\*Publish gate fires ONLY on \`ci-ready\` label event\*\* — not \`accepted\` — to prevent race where \`publish\` and \`waiting-for-ci\` run in parallel on the same \`labeled: accepted\` event when \`ci-ready\` is stale from a previous failed publish. \`waiting-for-ci\` job (on \`accepted\` labeled, when \`ci-pending\` or \`ci-failed\` present): removes \`ci-failed\` AND \`ci-ready\` (critical: stale \`ci-ready\` must be cleared so poller's re-add generates a fresh \`labeled\` event), adds \`ci-pending\`, comments, triggers poller. Concurrency group uses \`github.event.issue.title\` to lock on repo@version.

<!-- lore:019daf66-feec-78eb-a2a0-4e14f3b76453 -->
* **GitHub App token scoping for cross-repo CI status checks**: When a workflow in repo A needs to call APIs on repo B, \`secrets.GITHUB\_TOKEN\` won't work (scoped to repo A only). Use \`actions/create-github-app-token@v3\` with \`owner: \<org>\` to get a token with access to all org repos (app must be installed org-wide). In \`getsentry/publish\`, the CI poller uses TWO tokens: \`sentry-release-bot\` (installed on all getsentry repos) for cross-repo CI status calls, and \`sentry-internal-app\` for label/comment operations on the publish repo itself. Separate tokens because some repos don't have sentry-internal-app installed.

<!-- lore:019daf66-5dc3-7a5c-b169-be468d2ff29c -->
* **Use release-bot token for cross-repo API calls in getsentry org workflows**: The \`sentry-internal-app\` is NOT installed on all getsentry repos (e.g. \`sentry-xbox\`, \`sentry-playstation\`, \`sentry-switch\`, \`service-registry\`). Using its token for cross-repo API calls like \`gh api repos/{other-repo}/commits/...\` returns 404 "Not Found" — looks like a missing resource but is actually a missing installation. Use \`sentry-release-bot\` instead: configure with \`client-id: ${{ vars.SENTRY\_RELEASE\_BOT\_CLIENT\_ID }}\`, \`private-key: ${{ secrets.SENTRY\_RELEASE\_BOT\_PRIVATE\_KEY }}\`, and \`owner: getsentry\` to get a token with access to all org repos. Pattern in getsentry/publish CI poller: generate both tokens, use internal-app for publish-repo label changes, release-bot for cross-repo \`repos/{repo}/commits/{sha}/status\` and \`/check-runs\` API calls.
<!-- End lore-managed section -->
