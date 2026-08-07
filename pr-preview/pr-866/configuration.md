---
title: "Configuration"
description: "Complete reference for .craft.yml configuration"
url: "https://craft.sentry.dev/pr-preview/pr-866/configuration/"
---

# Configuration

Project configuration for Craft is stored in `.craft.yml` in the project root.

## GitHub Project

Craft tries to determine GitHub repo information from the local git repo. You can also hard-code it:

```yaml
github:
  owner: getsentry
  repo: sentry-javascript
```


## Pre-release Command

This command runs on your release branch as part of `craft prepare`. Default: `bash scripts/bump-version.sh`.

```yaml
preReleaseCommand: bash scripts/bump-version.sh
```


The command is executed with the following environment variables:

- `CRAFT_OLD_VERSION`: The previous version (or `0.0.0` if no previous version exists)
- `CRAFT_NEW_VERSION`: The new version being released

The script should:

- Use these environment variables to perform version replacement
- Replace version occurrences
- Not commit changes
- Not change git state

> **Note:** For backward compatibility, the old and new versions are also passed as the last two command-line arguments to the script, but using environment variables is safer and recommended.

Example script:

```bash
#!/bin/bash
set -eux


# Use CRAFT_NEW_VERSION provided by craft
export npm_config_git_tag_version=false
npm version "${CRAFT_NEW_VERSION}"
```


## Automatic Version Bumping

When `minVersion: "2.21.0"` or higher is set and no custom `preReleaseCommand` is defined, Craft automatically bumps version numbers based on your configured publish targets. This eliminates the need for a `scripts/bump-version.sh` script in most cases.

### How It Works

1. Craft examines your configured `targets` in `.craft.yml`
2. For each target that supports version bumping, Craft updates the appropriate project files
3. Targets are processed in the order they appear in your configuration
4. Each target type is only processed once (e.g., multiple npm targets won’t bump `package.json` twice)

### Supported Targets

| Target | Detection | Version Bump Method |
| --- | --- | --- |
| `npm` | `package.json` exists | `npm version --no-git-tag-version` (with workspace support) |
| `pypi` | `pyproject.toml` exists | hatch, poetry, setuptools-scm, or direct edit |
| `crates` | `Cargo.toml` exists | `cargo set-version` (requires cargo-edit) |
| `gem` | `*.gemspec` exists | Direct edit of gemspec and `lib/**/version.rb` |
| `pub-dev` | `pubspec.yaml` exists | Direct edit of pubspec.yaml |
| `hex` | `mix.exs` exists | Direct edit of mix.exs |
| `nuget` | `*.csproj` exists | dotnet-setversion or direct XML edit |

### npm Workspace Support

For npm/yarn/pnpm monorepos, Craft automatically detects and bumps versions in all workspace packages:

- **npm 7+**: Uses `npm version --workspaces` to bump all packages at once
- **yarn/pnpm or npm < 7**: Falls back to bumping each non-private package individually

Workspace detection checks for:

- `workspaces` field in root `package.json` (npm/yarn)
- `pnpm-workspace.yaml` (pnpm)

Private packages (`"private": true`) are skipped during workspace version bumping.

### Python (pypi) Detection Priority

For Python projects, Craft detects the build tool and uses the appropriate method:

1. **Hatch** - If `[tool.hatch]` section exists → `hatch version <version>`
2. **Poetry** - If `[tool.poetry]` section exists → `poetry version <version>`
3. **setuptools-scm** - If `[tool.setuptools_scm]` section exists → No-op (version derived from git tags)
4. **Direct edit** - If `[project]` section with `version` field exists → Edit `pyproject.toml` directly

### Enabling Automatic Version Bumping

To enable automatic version bumping, ensure your `.craft.yml` has:

```yaml
minVersion: '2.21.0'
targets:
  - name: npm # or pypi, crates, etc.
  # ... other targets
```


And either:

- Remove any custom `preReleaseCommand`, or
- Don’t define `preReleaseCommand` at all

### Disabling Automatic Version Bumping

To disable automatic version bumping while still using minVersion 2.21.0+:

```yaml
minVersion: '2.21.0'
preReleaseCommand: '' # Explicitly set to empty string
```


Or define a custom script:

```yaml
minVersion: '2.21.0'
preReleaseCommand: bash scripts/my-custom-bump.sh
```


### Error Handling

If automatic version bumping fails:

- **Missing tool**: Craft reports which tool is missing (e.g., “Cannot find ‘npm’ for version bumping”)
- **Command failure**: Craft shows the error from the failed command
- **No supported targets**: Craft warns that no targets support automatic bumping

In all error cases, Craft suggests defining a custom `preReleaseCommand` as a fallback.

### Recovery from Failed Prepare

If version bumping succeeds but `craft prepare` fails mid-way (e.g., during changelog generation or git operations), you may need to clean up manually:

1. **Check the release branch**: If a release branch was created, you can delete it:

   ```bash
   git branch -D release/<version>
   ```
2. **Revert version changes**: If files were modified but not committed, reset them:

   ```bash
   git checkout -- package.json pyproject.toml Cargo.toml  # or whichever files were changed
   ```
3. **Re-run prepare**: Once the issue is fixed, run `craft prepare` again. Version bumping is idempotent—running it multiple times with the same version is safe.

Tip

Use `craft prepare --dry-run` first to preview what changes will be made without modifying any files.

## Post-release Command

This command runs after a successful `craft publish`. Default: `bash scripts/post-release.sh`.

```yaml
postReleaseCommand: bash scripts/post-release.sh
```


## Release Branch Name

Override the release branch prefix. Default: `release`.

```yaml
releaseBranchPrefix: publish
```


Full branch name: `{releaseBranchPrefix}/{version}`

The prefix may contain slashes, which is useful for monorepos that release several independently-versioned products from one repository. Pairing a slashed `releaseBranchPrefix` with a per-product `github.tagPrefix` keeps each product’s release branches and tags separate:

```yaml
releaseBranchPrefix: release/cli
targets:
  - name: github
    tagPrefix: "cli@"
```


This produces branches like `release/cli/1.2.3` and tags like `cli@1.2.3`. See the [GitHub target docs](https://craft.sentry.dev/pr-preview/pr-866/configuration/targets/github.md#monorepo-independently-versioned-products) for the full monorepo pattern.

## Changelog Policies

Craft supports `simple` and `auto` changelog management modes.

### Simple Mode

Reminds you to add a changelog entry:

```yaml
changelog: CHANGES
```


Or with options:

```yaml
changelog:
  filePath: CHANGES.md
  policy: simple
```


### Auto Mode

Automatically generates changelog from commits:

```yaml
changelog:
  policy: auto
```


Auto mode uses `.github/release.yml` to categorize PRs. This file follows [GitHub’s release.yml format](https://docs.github.com/en/repositories/releasing-projects-on-github/automatically-generated-release-notes#configuring-automatically-generated-release-notes) with Craft-specific extensions.

#### Craft Extensions to release.yml

Craft extends GitHub’s format with two additional fields:

| Field | Description |
| --- | --- |
| `commit_patterns` | Array of regex patterns to match commit/PR titles (in addition to labels) |
| `semver` | Version bump type for auto-versioning: `major`, `minor`, or `patch` |

Required for Version Detection

The `semver` field is required for Craft’s automatic version detection to work. If you define a custom `.github/release.yml` without `semver` fields, PRs will still appear in the changelog but won’t contribute to suggested version bumps. The [changelog preview](/github-actions/#changelog-preview) will show “None” for semver impact.

#### Default Configuration

If `.github/release.yml` doesn’t exist, Craft uses these defaults based on [Conventional Commits](https://www.conventionalcommits.org/):

```yaml
changelog:
  exclude:
    labels:
      - skip-changelog
  categories:
    - title: Breaking Changes 🛠
      commit_patterns:
        - "^(?<type>\\w+(?:\\((?<scope>[^)]+)\\))?!:\\s*)"
      semver: major
    - title: Security 🔒
      commit_patterns:
        - "^(?<type>security(?:\\((?<scope>[^)]+)\\))?!?:\\s*)"
      semver: patch
    - title: New Features ✨
      commit_patterns:
        - "^(?<type>feat(?:\\((?<scope>[^)]+)\\))?!?:\\s*)"
      semver: minor
    - title: Bug Fixes 🐛
      commit_patterns:
        - "^(?<type>fix(?:\\((?<scope>[^)]+)\\))?!?:\\s*)"
        - '^Revert "'
      semver: patch
    - title: Documentation 📚
      commit_patterns:
        - "^(?<type>docs?(?:\\((?<scope>[^)]+)\\))?!?:\\s*)"
      semver: patch
    - title: Internal Changes 🔧
      commit_patterns:
        - "^(?<type>(?:build|refactor|meta|chore|ci|ref|perf|tests?|style)(?:\\((?<scope>[^)]+)\\))?!?:\\s*)"
      semver: patch
```

## Navigation

- [Docs home](https://craft.sentry.dev/pr-preview/pr-866/index.md)
- [Previous: Installation](https://craft.sentry.dev/pr-preview/pr-866/getting-started.md)
- [Next: GitHub Actions](https://craft.sentry.dev/pr-preview/pr-866/github-actions.md)
