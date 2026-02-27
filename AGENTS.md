# AGENTS.md

This file provides guidance for AI coding assistants working with the Craft codebase.

## Package Management

- **Always use `pnpm`** for package management. Never use `npm` or `yarn`.
- Node.js version is managed by [Volta](https://volta.sh/) (currently v22.12.0).
- Install dependencies with `pnpm install --frozen-lockfile`.

## Development Commands

| Command | Description |
|---------|-------------|
| `pnpm build` | Build the project (outputs to `dist/craft`) |
| `pnpm test` | Run tests |
| `pnpm lint` | Run ESLint |
| `pnpm fix` | Auto-fix lint issues |

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

<!-- This section is auto-maintained by lore (https://github.com/BYK/opencode-lore) -->
## Long-term Knowledge

### Gotcha

<!-- lore:019c9be1-33db-7bba-bb0a-297d5de6edb7 -->
* **prepare-dry-run e2e tests require EDITOR env var for git commit**: The 6 tests in \`src/\_\_tests\_\_/prepare-dry-run.e2e.test.ts\` fail in environments where \`EDITOR\` is unset and the terminal is non-interactive (e.g., headless CI agents, worktrees). The error is \`Terminal is dumb, but EDITOR unset\` from git refusing to commit without a message editor. These are environment-dependent failures, not code bugs. They pass in environments with \`EDITOR=vi\` or similar set.
<!-- lore:019c9be1-33d1-7b6e-b107-ae7ad42a4ea4 -->
* **pnpm overrides with >= can cross major versions — use ^ to constrain**: When using pnpm overrides to patch a transitive dependency vulnerability, \`"ajv@<6.14.0": ">=6.14.0"\` will resolve to the latest ajv (v8.x), not the latest 6.x. ajv v6 and v8 have incompatible APIs — this broke eslint (\`@eslint/eslintrc\` calls \`ajv\` v6 API, crashes with \`Cannot set properties of undefined (setting 'defaultMeta')\` on v8). Fix: use \`"ajv@<6.14.0": "^6.14.0"\` to constrain within the same major. This applies to any override where the target package has multiple major versions in the registry — always use \`^\` (or \`~\`) instead of \`>=\` to stay within the compatible major line.
<!-- lore:019c9be1-33ca-714e-8ad9-dfda5350a106 -->
* **pnpm overrides with version-range keys don't force upgrades of already-compatible resolutions**: pnpm overrides with version-range selectors like \`"minimatch@>=10.0.0 <10.2.1": ">=10.2.1"\` do NOT work as expected for forcing upgrades of transitive deps that already satisfy their parent's semver range. If a parent requests \`^10.1.1\` and pnpm resolves \`10.1.1\`, the override key \`>=10.0.0 <10.2.1\` should match but doesn't reliably force re-resolution — even with \`pnpm install --force\`. The workaround is a blanket override without a version selector: \`"minimatch": ">=10.2.1"\`. This is only safe when ALL consumers are on the same major version line (otherwise it's a breaking change). Verify first with \`pnpm why \<pkg>\` that no other major versions exist in the tree before using a blanket override.
<!-- lore:019c9ba5-5158-77df-b32d-08980d0753c4 -->
* **git notes are lost on commit amend — must re-attach to new SHA**: Git notes are attached to a specific commit SHA. When you \`git commit --amend\`, the old commit is replaced with a new one (different SHA), and the note attached to the old SHA becomes orphaned. After amending, you must re-add the note to the new commit with \`git notes add\` targeting the new SHA. This also affects \`git push --force\` of notes refs — the remote note ref still points to the old SHA.
<!-- lore:019c9aa1-f7c7-799a-b323-9f9ecd11eae9 -->
* **React useState async pitfall**: React useState setter is async — reading state immediately after setState returns stale value in dashboard components
<!-- lore:019c9aa1-f798-7404-8af1-06116f1636ba -->
* **TypeScript strict mode caveat**: TypeScript strict null checks require explicit undefined handling

### Architecture

<!-- lore:019c9be1-33d8-7edb-8e74-95d7369f4abb -->
* **Craft tsconfig.build.json is now self-contained — no @sentry/typescript base**: The \`@sentry/typescript\` package was removed as a dev dependency. It only provided a base \`tsconfig.json\` with strict TS settings, but dragged in deprecated \`tslint\` and vulnerable \`minimatch@3.1.2\`. All useful compiler options from its tsconfig are now inlined directly in \`tsconfig.build.json\`. Key settings carried forward: \`declaration\`, \`declarationMap\`, \`downlevelIteration\`, \`inlineSources\`, \`noFallthroughCasesInSwitch\`, \`noImplicitAny\`, \`noImplicitReturns\`, \`noUnusedLocals\`, \`noUnusedParameters\`, \`pretty\`, \`sourceMap\`, \`strict\`. The chain is: \`tsconfig.json\` extends \`tsconfig.build.json\` (no further extends).

### Pattern

<!-- lore:019c9bb9-a79b-71e0-9f71-d94e77119b4b -->
* **CLI UX: auto-correct common user mistakes with stderr warnings instead of hard errors**: When a CLI command can unambiguously detect a common user mistake (like using the wrong separator character), prefer auto-correcting the input and printing a warning to stderr over throwing a hard error. This is safe when: (1) the input is already invalid and would fail anyway, (2) there's no ambiguity in the correction, and (3) the warning goes to stderr so it doesn't interfere with JSON/stdout output. Implementation pattern: normalize inputs at the command level before passing to pure parsing functions, keeping the parsers side-effect-free. The \`gh\` CLI (GitHub CLI) is the UX model — match its conventions.
<!-- lore:019c9aa1-f79a-7f3c-94c6-1371d2fd7e62 -->
* **Kubernetes deployment pattern**: Use helm charts for Kubernetes deployments with resource limits

### Preference

<!-- lore:019c9aa1-f7a2-7c42-b067-a87eff21df63 -->
* **General coding preference**: Prefer explicit error handling over silent failures
<!-- lore:019c9aa1-f75c-7cf4-921e-cc1d5fdccbe7 -->
* **Code style**: User prefers no backwards-compat shims, fix callers directly
<!-- End lore-managed section -->
