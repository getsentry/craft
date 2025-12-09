# AGENTS.md

This file provides guidance for AI coding assistants working with the Craft codebase.

## Package Management

- **Always use `yarn`** (v1) for package management. Never use `npm` or `pnpm`.
- Node.js version is managed by [Volta](https://volta.sh/) (currently v22.12.0).
- Install dependencies with `yarn install --frozen-lockfile`.

## Development Commands

| Command | Description |
|---------|-------------|
| `yarn build` | Build the project (outputs to `dist/craft`) |
| `yarn test` | Run tests |
| `yarn lint` | Run ESLint |
| `yarn fix` | Auto-fix lint issues |

To manually test changes:

```bash
yarn build && ./dist/craft
```

## Code Style

- **TypeScript** is used throughout the codebase.
- **Prettier** with single quotes and no arrow parens (configured in `.prettierrc.yml`).
- **ESLint** extends `@typescript-eslint/recommended`.
- Unused variables prefixed with `_` are allowed (e.g., `_unusedParam`).

## Project Structure

```
src/
├── __mocks__/          # Test mocks
├── __tests__/          # Test files (*.test.ts)
├── artifact_providers/ # Artifact provider implementations
├── commands/           # CLI command implementations
├── schemas/            # JSON schema and TypeScript types for config
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

- Tests use **Jest** with `ts-jest`.
- Test files are located in `src/__tests__/` and follow the `*.test.ts` naming pattern.
- Run tests with `yarn test`.

## CI/CD

- Main branch is `master`.
- CI runs tests on Node.js 20 and 22.
- Craft releases itself using its own tooling (dogfooding).

## Configuration

- Project configuration lives in `.craft.yml` at the repository root.
- The configuration schema is defined in `src/schemas/`.
