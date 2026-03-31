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

### Gotcha

<!-- lore:019d4479-fd93-7328-a4b5-f9405e4aad8b -->
* **GitHub App tokens expire after 1 hour — breaks long-running CI publishes**: GitHub App installation tokens expire after 1 hour (non-configurable). For publish jobs exceeding this (e.g., sentry-native's ~1h 23m symbol upload), the token expires before Craft's post-publish \`git push\` for the release branch merge. Git fails with \`could not read Username for 'https://github.com': No such device or address\` — which looks like a credential config issue but is actually token expiration. No code change in Craft alone can fix this — the \`GITHUB\_TOKEN\` env var, git \`http.extraheader\`, and Octokit all use the same expired token. The real fix requires the CI workflow (\`getsentry/publish\`) to generate a fresh token after the Docker container exits, before the merge step.

<!-- lore:019d4479-fd9a-7a97-931f-8f9a18e5752e -->
* **prepare-dry-run e2e tests fail without EDITOR in dumb terminals**: The 7 tests in \`src/\_\_tests\_\_/prepare-dry-run.e2e.test.ts\` fail in environments where \`TERM=dumb\` and \`EDITOR\` is unset (e.g., inside agent shells or minimal CI containers). The error is \`Terminal is dumb, but EDITOR unset\` from git commit. This is a pre-existing environment issue, not a code defect. These tests pass in normal CI (Node.js 20/22 runners) where terminal capabilities are available.

### Pattern

<!-- lore:019d4479-fd97-764e-a7ec-0d32360b0f16 -->
* **Craft Docker container auth: credentials come from volume-mounted git config**: When Craft runs inside Docker in CI (via \`getsentry/craft:latest\`), git authentication comes from \`actions/checkout\`'s \`http.extraheader\` in the local \`.git/config\`, which is volume-mounted into the container at \`/github/workspace\`. The container sets \`HOME=/root\`, so global git config from the host runner isn't available. The \`GITHUB\_TOKEN\` env var is passed separately. Craft's \`handleReleaseBranch()\` doesn't set up its own auth — it relies on whatever git config is present. Other targets (registry, commitOnGitRepository) explicitly inject tokens into clone URLs via \`GitHubRemote.getRemoteStringWithAuth()\` or URL manipulation.
<!-- End lore-managed section -->
