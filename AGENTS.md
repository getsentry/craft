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

### Gotcha

<!-- lore:019ca05d-1ee2-759e-8a57-596470be9a3a -->
* **Craft changelog: commits without PRs were forced into leftovers regardless of category match**: In \`src/utils/changelog.ts\`, the leftovers guard at the categorization step had \`if (!categoryTitle || !raw.pr)\` — the \`|| !raw.pr\` condition forced ALL commits without associated PRs into the "Other" leftovers section, even when they matched a category via \`commit\_patterns\` or labels. This meant direct pushes (no PR) like \`feat(auth): add SSO\` would correctly contribute to version bump calculation (which runs before the leftovers check) but would appear under "Other" in the changelog instead of their matched category. Fix: remove \`|| !raw.pr\` so only \`!categoryTitle\` controls leftover placement. The downstream rendering already handles PR-less commits gracefully — \`createPREntriesFromRaw\` uses \`raw.pr ?? ''\`, and \`formatChangelogEntry\` falls back to commit-hash links when \`prNumber\` is falsy (empty string).

<!-- lore:019c9ba5-515b-70c8-bc1a-1221f6858b42 -->
* **Edit tool triggers Prettier reformatting on the entire file**: When using the Edit tool to make a targeted change to a file in a repo with Prettier configured, the tool may reformat the entire file (e.g., aligning markdown table columns, changing quote styles). This causes the git diff to show cosmetic changes far beyond the intended edit. To keep commits clean: either accept the Prettier reformatting as a net improvement (if the file passes \`prettier --check\`), or use \`git checkout -- \<file>\` to restore the original and re-apply the change via bash/sed for surgical precision. In this codebase, Prettier is configured (\`.prettierrc.yml\`) but the lint CI workflow does NOT run \`prettier --check\`, only ESLint and typecheck.

<!-- lore:019c9eb7-a640-776a-929d-89120f81733a -->
* **pnpm-lock.yaml merge conflicts: regenerate don't manually merge**: pnpm gotchas: (1) Lock file conflicts: never manually resolve — \`git checkout --theirs pnpm-lock.yaml\` then \`pnpm install\` to regenerate. \`git stash pop\` after merge can re-conflict; drop the stash and re-run instead. (2) Overrides: \`>=\` crosses major versions — use \`^\` to stay in-major. Version-range selectors don't reliably force re-resolution of compatible transitive deps; use blanket overrides when all consumers are on same major. (3) Overrides go stale on tree changes — audit with \`pnpm why\` and remove orphans.

### Pattern

<!-- lore:019c9ba5-515c-7131-a1e6-10f93443d0e2 -->
* **AGENTS.md lore section: only include project-relevant entries**: The \`\<!-- lore-managed section -->\` in AGENTS.md is auto-maintained by the lore tool and can accumulate cross-project entries (React, Kubernetes, etc.) that are irrelevant to the Craft codebase. When committing AGENTS.md changes, review the lore section and strip entries that don't pertain to this repo. Only project-specific patterns (like the \`publish\_repo: self\` sentinel) should be included.

<!-- lore:019c9b36-8f9d-71c9-a43a-d2715aa249d0 -->
* **Craft publish\_repo 'self' sentinel resolves to GITHUB\_REPOSITORY at runtime**: The composite action's \`publish\_repo\` input supports a special sentinel value \`"self"\` which resolves to \`$GITHUB\_REPOSITORY\` at runtime in the bash script of the 'Request publish' step. This allows repos to create publish request issues in themselves rather than in a separate \`{owner}/publish\` repo. The resolution happens in bash (not in the GitHub Actions expression) because the expression layer sets \`PUBLISH\_REPO\` via \`inputs.publish\_repo || format('{0}/publish', github.repository\_owner)\` — the string \`"self"\` passes through as-is and gets resolved to the actual repo name in the shell. Useful for personal/small repos where the default GITHUB\_TOKEN already has write access to the repo itself.
<!-- End lore-managed section -->
