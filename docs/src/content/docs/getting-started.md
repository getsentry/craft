---
title: Getting Started
description: How to install and use Craft
---

## Installation

### Binary

Craft is [distributed as a minified single JS binary](https://github.com/getsentry/craft/releases/latest). Download the latest release and add it to your PATH.

### npm (not recommended)

While the recommended approach is to use the binary directly, you can also install Craft as an [NPM package](https://www.npmjs.com/package/@sentry/craft):

```shell
pnpm add -g @sentry/craft
```

```shell
npm install -g @sentry/craft
```

## Quick Start with `craft init`

The fastest way to get started is using `craft init`, which auto-detects your project type and generates configuration:

```shell
cd your-project
craft init
```

This will:

1. Detect your project type (npm, PyPI, Cargo, etc.)
2. Generate a `.craft.yml` configuration file
3. Create GitHub Actions workflows for release automation

Example output:

```
[info] Detecting project type...
[info] ✓ Found GitHub repository: your-org/your-repo
[info] ✓ Detected 2 target(s):
  - npm
  - github
[info] ✓ Detected Node.js project (pnpm)

Proposed .craft.yml:
────────────────────────────────────────
minVersion: "2.21.0"
targets:
  - name: npm
  - name: github
────────────────────────────────────────
? Create .craft.yml? (Y/n)
```

After initialization, validate your configuration:

```shell
craft validate
```

## Usage

```shell
$ craft -h
craft <command>

Commands:
  craft init                 Initialize Craft configuration for a new project
  craft prepare [NEW-VERSION] 🚢 Prepare a new release branch
                          [aliases: p, prerelease, prepublish, prepare, release]
  craft publish NEW-VERSION  🛫 Publish artifacts         [aliases: pp, publish]
  craft validate             Validate Craft configuration and workflows
  craft targets              List defined targets as JSON array
  craft config               Print the parsed, processed, and validated Craft
                             config for the current project in pretty-JSON.
  craft artifacts <command>  📦 Manage artifacts          [aliases: a, artifact]

Options:
  --no-input     Suppresses all user prompts                    [default: false]
  --dry-run      Dry run mode: no file writes, commits, pushes, or API mutations
  --log-level    Logging level
          [choices: "Fatal", "Error", "Warn", "Log", "Info", "Success", "Debug",
                                 "Trace", "Silent", "Verbose"] [default: "Info"]
  -v, --version  Show version number                                   [boolean]
  -h, --help     Show help                                             [boolean]
```

## Workflow

### `craft init`: Initialize a New Project

Auto-detect your project type and generate configuration:

```shell
craft init

Initialize Craft configuration for a new project

Options:
  --skip-workflows  Skip generating GitHub Actions workflow files
  --force           Overwrite existing files
  -h, --help        Show help
```

The `init` command detects:

- **Package managers**: npm, pnpm, yarn, pip, cargo, etc.
- **Project files**: package.json, pyproject.toml, Cargo.toml, Dockerfile, etc.
- **GitHub info**: owner and repo from git remote

Generated files:

- `.craft.yml` - Main configuration
- `.github/workflows/release.yml` - Release preparation workflow
- `.github/workflows/changelog-preview.yml` - PR changelog preview

:::note
Publishing is typically handled via a separate repository that stores secrets securely. See [Publishing Configuration](/configuration#publishing) for details.
:::

### `craft validate`: Validate Configuration

Check your configuration for errors and best practices:

```shell
craft validate

Options:
  --skip-workflows  Skip validating GitHub Actions workflow files
  -h, --help        Show help
```

Validates:

- YAML syntax and schema
- Target names exist
- No duplicate target IDs
- Regex patterns are valid
- Workflow files use recommended patterns

### `craft prepare`: Preparing a New Release

This command creates a new release branch, checks the changelog entries, runs a version-bumping script, and pushes this branch to GitHub. CI triggered by pushing this branch will build release artifacts and upload them to your artifact provider.

**Version Specification**

The `NEW-VERSION` argument can be specified in several ways (or omitted to use `auto`):

1. **Omitted**: Uses `auto` by default (or `versioning.policy` from `.craft.yml` if configured)
2. **Explicit version** (e.g., `1.2.3`): Release with the specified version
3. **Bump type** (`major`, `minor`, or `patch`): Automatically increment the latest tag
4. **Auto** (`auto`): Analyze commits since the last tag and determine bump type from conventional commit patterns
5. **CalVer** (`calver`): Use calendar-based versioning

**First Release**

When no git tags exist (first release), Craft defaults to a `minor` bump from `0.0.0` (resulting in `0.1.0`) when using auto-versioning. This ensures a sensible starting point for new projects.

```shell
craft prepare [NEW-VERSION]

🚢 Prepare a new release branch

Positionals:
  NEW-VERSION  The new version to release. Can be: a semver string (e.g.,
               "1.2.3"), a bump type ("major", "minor", or "patch"), "auto"
               to determine automatically from conventional commits, or "calver"
               for calendar versioning. When omitted, defaults to "auto".
                                                                        [string]

Options:
  --no-input       Suppresses all user prompts                  [default: false]
  --dry-run        Dry run mode: no file writes, commits, pushes, or API mutations
  --rev, -r        Source revision (git SHA or tag) to prepare from
  --no-push        Do not push the release branch     [boolean] [default: false]
  --no-git-checks  Ignore local git changes and unsynchronized remotes
  --no-changelog   Do not check for changelog entries [boolean] [default: false]
  --publish        Run "publish" right after "release"[boolean] [default: false]
  --remote         The git remote to use when pushing [string] [default: "origin"]
  --config-from    Load .craft.yml from specified remote branch
  --calver-offset  Days to go back for CalVer date calculation
  -v, --version    Show version number                                 [boolean]
  -h, --help       Show help                                           [boolean]
```

### `craft publish`: Publishing the Release

This command finds a release branch for the provided version, checks the build status, downloads release artifacts, and uploads them to configured targets.

```shell
craft publish NEW-VERSION

🛫 Publish artifacts

Positionals:
  NEW-VERSION  Version to publish                            [string] [required]

Options:
  --no-input         Suppresses all user prompts                [default: false]
  --dry-run          Dry run mode: no file writes, commits, pushes, or API mutations
  --target, -t       Publish to this target                     [default: "all"]
  --rev, -r          Source revision (git SHA or tag) to publish
  --no-merge         Do not merge the release branch after publishing
  --keep-branch      Do not remove release branch after merging it
  --keep-downloads   Keep all downloaded files        [boolean] [default: false]
  --no-status-check  Do not check for build status    [boolean] [default: false]
  -v, --version      Show version number                               [boolean]
  -h, --help         Show help                                         [boolean]
```

### `craft changelog`: Generate Changelog

Generate a changelog from git history without preparing a release. This is useful for previewing what would be included in a release or for CI integrations.

```shell
craft changelog

Generate changelog from git history

Options:
  --since, -s    Base revision (tag or SHA) to generate from. Defaults to latest tag.
  --pr           PR number for the current (unmerged) PR to include with highlighting.
  --format, -f   Output format: text (default) or json
```

Examples:

```shell
# Generate changelog since last tag
craft changelog

# Generate changelog since specific commit
craft changelog --since 2b58d3c

# Get detailed JSON output including bump type and commit stats
craft changelog --format json
```

:::note
This command requires `GITHUB_TOKEN` to fetch PR information from GitHub.
:::

### Example

Let's release version `1.2.3`:

```shell
# Prepare the release
$ craft prepare 1.2.3
```

This creates a release branch `release/1.2.3`, runs the version-bumping script, commits changes, and pushes to GitHub. CI builds artifacts and uploads them.

```shell
# Publish the release
$ craft publish 1.2.3
```

This finds the release branch, waits for CI to pass, downloads artifacts, and publishes to configured targets (e.g., GitHub and NPM).

## Version Naming Conventions

Craft supports [semantic versioning (semver)](https://semver.org)-like versions:

```txt
<major>.<minor>.<patch>(-<prerelease>)?(-<build>)?
```

- The `<major>`, `<minor>`, and `<patch>` numbers are required
- The `<prerelease>` and `<build>` identifiers are optional

### Preview Releases

Preview or pre-release identifiers **must** include one of:

```txt
preview|pre|rc|dev|alpha|beta|unstable|a|b
```

Examples:

- `1.0.0-preview`
- `1.0.0-alpha.0`
- `1.0.0-beta.1`
- `1.0.0-rc.20`

### Build Identifiers

Add a build identifier for platform-specific releases:

```txt
1.0.0+x86_64
1.0.0-rc.1+x86_64
```

## Global Configuration

Configure Craft using environment variables or configuration files.

All command line flags can be set through environment variables by prefixing them with `CRAFT_`:

```shell
CRAFT_LOG_LEVEL=Debug
CRAFT_DRY_RUN=1
CRAFT_NO_INPUT=0
```

### Dry-Run Mode

The `--dry-run` flag lets you preview what would happen without making real changes.

**How it works:**

Craft creates a temporary git worktree where all local operations run normally (branch creation, file modifications, commits). At the end, it shows a diff of what would change:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Dry-run complete. Here's what would change:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Files changed: 2
 M CHANGELOG.md
 M package.json

diff --git a/CHANGELOG.md b/CHANGELOG.md
...
```

**What's blocked:**

- Git push (nothing leaves your machine)
- GitHub API mutations (no releases, uploads, or changes)

**What's allowed:**

- All local operations (in a temporary worktree)
- Reading from GitHub API (requires `GITHUB_TOKEN`)

:::note
Dry-run still requires `GITHUB_TOKEN` for commands that fetch PR information from GitHub.
:::

### GitHub Token

Since Craft relies heavily on GitHub, set the `GITHUB_TOKEN` environment variable to a [GitHub Personal Access Token](https://github.com/settings/tokens) with `repo` scope.

### Environment Files

Craft reads configuration from these locations (in order of precedence):

1. `$HOME/.craft.env`
2. `$PROJECT_DIR/.craft.env`
3. Shell environment

Example `.craft.env`:

```shell
# ~/.craft.env
GITHUB_TOKEN=token123
export NUGET_API_TOKEN=abcdefgh
```

## Caveats

- When interacting with remote GitHub repositories, Craft uses the remote `origin` by default. Set `CRAFT_REMOTE` or use the `--remote` option to change this.

## Integrating Your Project

### Quick Setup (Recommended)

Use `craft init` to automatically generate configuration:

```shell
cd your-project
craft init
craft validate
```

Then set up required secrets in your GitHub repository and run your first release.

### Manual Setup

1. **Set up a workflow** that builds assets and runs tests. Allow building release branches:

   ```yaml
   on:
     push:
       branches:
         - 'release/**'
   ```

2. **Upload artifacts** using `actions/upload-artifact@v2`:

   ```yaml
   - name: Archive Artifacts
     uses: actions/upload-artifact@v2
     with:
       name: ${{ github.sha }}
       path: |
         ${{ github.workspace }}/*.tgz
   ```

   Note: The artifact name must be `${{ github.sha }}`.

3. **Add `.craft.yml`** to your project with targets and options.

4. **Set up version bumping** (one of):
   - **Automatic** (recommended): Set `minVersion: "2.19.0"` and Craft will automatically bump versions based on your targets (npm, pypi, crates, etc.)
   - **Custom script**: Add `scripts/bump-version.sh` (or set `preReleaseCommand`)

5. **Configure environment variables** for your targets.

6. **Run** `craft prepare <version> --publish`!

## First Release

For new projects with no existing releases, Craft provides a streamlined experience:

1. **Initialize**: Run `craft init` to generate configuration
2. **Validate**: Run `craft validate` to check your setup
3. **Release**: Run `craft prepare` (version defaults to `0.1.0`)

Example first release workflow:

```shell
# Initialize (one-time setup)
craft init
craft validate

# Set up secrets in GitHub (GH_RELEASE_PAT, NPM_TOKEN, etc.)

# Create your first release
craft prepare  # Defaults to 0.1.0 for first release
# Or explicitly: craft prepare 0.1.0

# After CI completes, publish
craft publish 0.1.0
```

With smart defaults enabled (`minVersion: "2.21.0"`), Craft will:

- Auto-detect version bumps from commits
- Automatically generate changelogs
- Create `CHANGELOG.md` if it doesn't exist
