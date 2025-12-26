---
title: Getting Started
description: How to install and use Craft
---

## Installation

### Binary

Craft is [distributed as a minified single JS binary](https://github.com/getsentry/craft/releases/latest). Download the latest release and add it to your PATH.

### npm (not recommended)

While the recommended approach is to use the binary directly, you can also install Craft as an [NPM package](https://yarn.pm/@sentry/craft):

```shell
yarn global add @sentry/craft
```

```shell
npm install -g @sentry/craft
```

## Usage

```shell
$ craft -h
craft <command>

Commands:
  craft prepare NEW-VERSION  🚢 Prepare a new release branch
                          [aliases: p, prerelease, prepublish, prepare, release]
  craft publish NEW-VERSION  🛫 Publish artifacts         [aliases: pp, publish]
  craft targets              List defined targets as JSON array
  craft config               Print the parsed, processed, and validated Craft
                             config for the current project in pretty-JSON.
  craft artifacts <command>  📦 Manage artifacts          [aliases: a, artifact]

Options:
  --no-input     Suppresses all user prompts                    [default: false]
  --dry-run      Dry run mode: do not perform any real actions
  --log-level    Logging level
          [choices: "Fatal", "Error", "Warn", "Log", "Info", "Success", "Debug",
                                 "Trace", "Silent", "Verbose"] [default: "Info"]
  -v, --version  Show version number                                   [boolean]
  -h, --help     Show help                                             [boolean]
```

## Workflow

### `craft prepare`: Preparing a New Release

This command creates a new release branch, checks the changelog entries, runs a version-bumping script, and pushes this branch to GitHub. CI triggered by pushing this branch will build release artifacts and upload them to your artifact provider.

**Version Specification**

The `NEW-VERSION` argument can be specified in three ways:

1. **Explicit version** (e.g., `1.2.3`): Release with the specified version
2. **Bump type** (`major`, `minor`, or `patch`): Automatically increment the latest tag
3. **Auto** (`auto`): Analyze commits since the last tag and determine bump type from conventional commit patterns

```shell
craft prepare NEW-VERSION

🚢 Prepare a new release branch

Positionals:
  NEW-VERSION  The new version to release. Can be: a semver string (e.g.,
               "1.2.3"), a bump type ("major", "minor", or "patch"), or "auto"
               to determine automatically from conventional commits.
                                                             [string] [required]

Options:
  --no-input       Suppresses all user prompts                  [default: false]
  --dry-run        Dry run mode: do not perform any real actions
  --rev, -r        Source revision (git SHA or tag) to prepare from
  --no-push        Do not push the release branch     [boolean] [default: false]
  --no-git-checks  Ignore local git changes and unsynchronized remotes
  --no-changelog   Do not check for changelog entries [boolean] [default: false]
  --publish        Run "publish" right after "release"[boolean] [default: false]
  --remote         The git remote to use when pushing [string] [default: "origin"]
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
  --dry-run          Dry run mode: do not perform any real actions
  --target, -t       Publish to this target                     [default: "all"]
  --rev, -r          Source revision (git SHA or tag) to publish
  --no-merge         Do not merge the release branch after publishing
  --keep-branch      Do not remove release branch after merging it
  --keep-downloads   Keep all downloaded files        [boolean] [default: false]
  --no-status-check  Do not check for build status    [boolean] [default: false]
  -v, --version      Show version number                               [boolean]
  -h, --help         Show help                                         [boolean]
```

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

4. **Add a pre-release script** (default: `scripts/bump-version.sh`).

5. **Configure environment variables** for your targets.

6. **Run** `craft prepare <version> --publish`!
