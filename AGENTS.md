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

<!-- lore:019c9f57-aa0f-70b2-82fb-e87fb9fc591f -->
* **Craft npm target auth: temp .npmrc via npm\_config\_userconfig bypasses all default config**: Craft's npm target creates a temporary \`.npmrc\` file containing \`//registry.npmjs.org/:\_authToken=${NPM\_TOKEN}\` and sets the \`npm\_config\_userconfig\` env var to point to it. This completely overrides npm's default config file lookup chain — the user's home \`.npmrc\` and project \`.npmrc\` are both bypassed. This is why OIDC (which relies on \`setup-node\` creating a properly configured project \`.npmrc\`) requires a separate code path that skips the temp file entirely. The pattern is used in both \`publishPackage()\` and \`getLatestVersion()\`. The \`npm\_config\_userconfig\` approach (instead of \`--userconfig\` CLI flag) was chosen for yarn compatibility.

<!-- lore:019c9be1-33d8-7edb-8e74-95d7369f4abb -->
* **Craft tsconfig.build.json is now self-contained — no @sentry/typescript base**: The \`@sentry/typescript\` package was removed as a dev dependency. It only provided a base \`tsconfig.json\` with strict TS settings, but dragged in deprecated \`tslint\` and vulnerable \`minimatch@3.1.2\`. All useful compiler options from its tsconfig are now inlined directly in \`tsconfig.build.json\`. Key settings carried forward: \`declaration\`, \`declarationMap\`, \`downlevelIteration\`, \`inlineSources\`, \`noFallthroughCasesInSwitch\`, \`noImplicitAny\`, \`noImplicitReturns\`, \`noUnusedLocals\`, \`noUnusedParameters\`, \`pretty\`, \`sourceMap\`, \`strict\`. The chain is: \`tsconfig.json\` extends \`tsconfig.build.json\` (no further extends).

### Gotcha

<!-- lore:019c9f57-aa0c-7a2a-8a10-911b13b48fc0 -->
* **ESM modules prevent vi.spyOn of child\_process.spawnSync — use test subclass pattern**: In ESM (Vitest or Bun), you cannot \`vi.spyOn\` exports from Node built-in modules — throws 'Module namespace is not configurable'. Workaround: create a test subclass that overrides the method calling the built-in and injects controllable values. \`vi.mock\` at module level works but affects all tests in the file.

<!-- lore:019c9ee7-f55f-7697-b9b4-e7b9c93e9858 -->
* **Lore tool seeds generic entries unrelated to the project — clean before committing**: The opencode-lore tool (https://github.com/BYK/opencode-lore) can seed AGENTS.md with generic/template lore entries that are unrelated to the actual project. These are identifiable by: (1) shared UUID prefix like \`019c9aa1-\*\` suggesting batch creation, (2) content referencing technologies not in the codebase (e.g., React useState, Kubernetes helm charts, TypeScript strict mode boilerplate in a Node CLI project). These mislead AI assistants about the project's tech stack. Always review lore-managed sections in AGENTS.md before committing and remove entries that don't apply to the actual codebase. Cursor BugBot will flag these as "Irrelevant lore entries."

<!-- lore:019c9be1-33d1-7b6e-b107-ae7ad42a4ea4 -->
* **pnpm overrides with >= can cross major versions — use ^ to constrain**: pnpm overrides gotchas: (1) \`>=\` crosses major versions — use \`^\` to constrain within same major. (2) Version-range selectors don't reliably force re-resolution of compatible transitive deps; use blanket overrides when safe. (3) Overrides become stale — audit with \`pnpm why \<pkg>\` after dependency changes. (4) Never manually resolve pnpm-lock.yaml conflicts — \`git checkout --theirs\` then \`pnpm install\` to regenerate deterministically.

<!-- lore:019c9be1-33db-7bba-bb0a-297d5de6edb7 -->
* **prepare-dry-run e2e tests require EDITOR env var for git commit**: The 6 tests in \`src/\_\_tests\_\_/prepare-dry-run.e2e.test.ts\` fail in environments where \`EDITOR\` is unset and the terminal is non-interactive (e.g., headless CI agents, worktrees). The error is \`Terminal is dumb, but EDITOR unset\` from git refusing to commit without a message editor. These are environment-dependent failures, not code bugs. They pass in environments with \`EDITOR=vi\` or similar set.

### Pattern

<!-- lore:019c9bb9-a79b-71e0-9f71-d94e77119b4b -->
* **CLI UX: auto-correct common user mistakes with stderr warnings instead of hard errors**: When a CLI command can unambiguously detect a user mistake (e.g., wrong separator character), auto-correct and print a warning to stderr instead of a hard error. Safe when: input would fail anyway, no ambiguity, warning goes to stderr. Normalize at command level, keep parsers pure. Model after \`gh\` CLI conventions.

<!-- lore:019c9f57-aa11-74f6-9532-7c8a45fe12a5 -->
* **Craft npm target OIDC detection via CI environment variables**: The \`isOidcEnvironment()\` helper in \`src/targets/npm.ts\` detects OIDC capability by checking CI-specific env vars that npm itself uses for OIDC token exchange: - \*\*GitHub Actions:\*\* \`ACTIONS\_ID\_TOKEN\_REQUEST\_URL\` AND \`ACTIONS\_ID\_TOKEN\_REQUEST\_TOKEN\` (both present when \`id-token: write\` permission is set) - \*\*GitLab CI/CD:\*\* \`NPM\_ID\_TOKEN\` (present when \`id\_tokens\` with \`aud: "npm:registry.npmjs.org"\` is configured) This auto-detection means zero config changes for the common case. The explicit \`oidc: true\` config is only needed to force OIDC when \`NPM\_TOKEN\` is also set (e.g., migration period).

<!-- lore:019c9eb7-a633-78aa-aaeb-8ddca3719975 -->
* **Craft publish\_repo 'self' sentinel resolves to GITHUB\_REPOSITORY at runtime**: The Craft composite action's \`publish\_repo\` input supports a special sentinel value \`"self"\` which resolves to \`$GITHUB\_REPOSITORY\` at runtime in the bash script of the 'Request publish' step. This allows repos to create publish request issues in themselves rather than in a separate \`{owner}/publish\` repo. The resolution happens in bash (not in the GitHub Actions expression) because the expression layer sets \`PUBLISH\_REPO\` via \`inputs.publish\_repo || format('{0}/publish', github.repository\_owner)\` — the string \`"self"\` passes through as-is and gets resolved to the actual repo name in the shell. Useful for personal/small repos where the default GITHUB\_TOKEN already has write access to the repo itself.

<!-- lore:019c9fa3-fcfe-7b07-8351-90944df38ca0 -->
* **Craft uses home-grown SemVer utils — don't add semver package for version comparisons**: Despite \`semver\` being a dependency (used in \`src/utils/autoVersion.ts\` for \`semver.inc()\`), the codebase has its own \`SemVer\` interface and utilities in \`src/utils/version.ts\`: \`parseVersion()\`, \`versionGreaterOrEqualThan()\`, \`isPreviewRelease()\`, etc. These are used throughout the codebase (npm target, publish tag logic, etc.). When adding version comparison logic, use these existing utilities rather than introducing new custom comparison functions or reaching for the \`semver\` package. Example: the OIDC minimum npm version check was initially implemented with 3 separate constants and a custom comparison helper, then refactored to a single \`SemVer\` constant + \`versionGreaterOrEqualThan()\`.
<!-- End lore-managed section -->
