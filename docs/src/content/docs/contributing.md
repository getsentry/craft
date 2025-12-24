---
title: Contributing
description: How to contribute to Craft
---

Thank you for your interest in contributing to Craft! This guide will help you get started.

## Development Setup

### Prerequisites

- Node.js v22+ (managed by [Volta](https://volta.sh/))
- Yarn v1

### Installation

```bash
# Clone the repository
git clone https://github.com/getsentry/craft.git
cd craft

# Install dependencies
yarn install --frozen-lockfile
```

## Development Commands

| Command | Description |
|---------|-------------|
| `yarn build` | Build the project (outputs to `dist/craft`) |
| `yarn test` | Run tests |
| `yarn lint` | Run ESLint |
| `yarn fix` | Auto-fix lint issues |

### Manual Testing

To test your changes locally:

```bash
yarn build && ./dist/craft
```

## Project Structure

```
src/
├── __mocks__/           # Test mocks
├── __tests__/           # Test files (*.test.ts)
├── artifact_providers/  # Artifact provider implementations
├── commands/            # CLI command implementations
├── schemas/             # JSON schema and TypeScript types
├── status_providers/    # Status provider implementations
├── targets/             # Release target implementations
├── types/               # Shared TypeScript types
├── utils/               # Utility functions
├── config.ts            # Configuration loading
├── index.ts             # CLI entry point
└── logger.ts            # Logging utilities
```

## Code Style

- **TypeScript** throughout the codebase
- **Prettier** for formatting (single quotes, no arrow parens)
- **ESLint** with `@typescript-eslint/recommended`
- Unused variables prefixed with `_` are allowed

## Testing

- Tests use **Jest** with `ts-jest`
- Test files are in `src/__tests__/` with the `*.test.ts` pattern

```bash
# Run all tests
yarn test

# Run tests in watch mode
yarn test:watch
```

## Adding a New Target

1. Create a new file in `src/targets/` (e.g., `myTarget.ts`)
2. Implement the `BaseTarget` interface
3. Register the target in `src/targets/index.ts`
4. Add configuration schema in `src/schemas/`
5. Write tests in `src/__tests__/`
6. Document the target in the docs

## Pull Requests

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests and linting
5. Submit a pull request

## Pre-release Script Conventions

The pre-release script (`scripts/bump-version.sh`) should:

- Accept old and new version as the last two arguments
- Replace version occurrences in project files
- **Not** commit changes
- **Not** change git state

Example:

```bash
#!/bin/bash
set -eux
OLD_VERSION="${1}"
NEW_VERSION="${2}"

export npm_config_git_tag_version=false
npm version "${NEW_VERSION}"
```

## Post-release Script Conventions

The post-release script (`scripts/post-release.sh`) runs after successful publish and should:

- Accept old and new version as arguments
- Handle its own git operations (commit, push)

## Questions?

- Open an issue on [GitHub](https://github.com/getsentry/craft/issues)
- Check existing issues and pull requests
