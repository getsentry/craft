---
title: "CLI Reference"
description: "Craft commands, global options, and environment variables"
url: "https://craft.sentry.dev/pr-preview/pr-939/cli/"
---

# CLI Reference

Run `craft <command> --help` for the authoritative list of options in your installed version.

## Commands

| Command | Description |
| --- | --- |
| [`craft prepare [NEW-VERSION]`](#craft-prepare) | Create and push a release branch. Aliases: `p`, `prerelease`, `prepublish`, `release` |
| [`craft publish NEW-VERSION`](#craft-publish) | Publish artifacts to targets. Alias: `pp` |
| [`craft changelog`](#craft-changelog) | Generate a changelog from git history |
| [`craft targets`](#craft-targets) | List configured targets as a JSON array |
| [`craft config`](#craft-config) | Print the parsed and validated configuration as JSON |
| [`craft artifacts <command>`](#craft-artifacts) | List or download artifacts. Aliases: `a`, `artifact` |
| [`craft workspace list`](#craft-workspace) | List release workspaces as a JSON array |
| `craft setup` | Install shell completions and agent skills. See [Installation](https://craft.sentry.dev/pr-preview/pr-939/installation.md#shell-completion) |
| `craft completion [shell]` | Print a shell completion script |
| `craft update [version]` | Update a standalone executable. See [Installation](https://craft.sentry.dev/pr-preview/pr-939/installation.md#updating-a-standalone-installation) |

## Global options

These options work with every command:

| Option | Description |
| --- | --- |
| `--dry-run` | Make no file writes, commits, pushes, or API mutations. See [Dry-run mode](#dry-run-mode). |
| `--no-input` | Suppress all user prompts. |
| `--log-level` | `Fatal`, `Error`, `Warn`, `Log`, `Info` (default), `Success`, `Debug`, `Trace`, `Silent`, or `Verbose`. |
| `--workspace` | Select a [release workspace](https://craft.sentry.dev/pr-preview/pr-939/workspaces.md). Required when the configuration defines `workspaces`. |
| `--ai-endpoint`, `--ai-model`, `--ai-api-key-env` | Override [AI summary](https://craft.sentry.dev/pr-preview/pr-939/ai-summaries.md#connection-settings) connection settings. |
| `-v`, `--version` | Show the Craft version. |
| `-h`, `--help` | Show help. |

## Environment variables

Every command-line option can also be set as an environment variable with the `CRAFT_` prefix:

```shell
CRAFT_LOG_LEVEL=Debug
CRAFT_DRY_RUN=1
CRAFT_WORKSPACE=packages/cli
CRAFT_REMOTE=upstream
```


### GitHub token

Craft relies heavily on GitHub. Set `GITHUB_TOKEN` to a [GitHub personal access token](https://github.com/settings/tokens) with `repo` scope. Read-only commands such as `craft changelog` and dry runs need it too, because they fetch pull request information.

### Credentials

Provide credentials (`GITHUB_TOKEN`, `NPM_TOKEN`, and so on) through your shell or CI environment. Each [target](https://craft.sentry.dev/pr-preview/pr-939/targets.md) lists the variables it needs. Craft no longer reads `.craft.env` files and warns at startup if it finds one in your home or project directory.

## craft prepare

Creates a release branch, bumps versions, checks or generates the changelog, and pushes the branch. See [Release Workflow → Prepare](https://craft.sentry.dev/pr-preview/pr-939/release-workflow.md#prepare).

`NEW-VERSION` can be a semver string (`1.2.3`), a bump type (`major`, `minor`, `patch`), `auto`, or `calver`. When omitted, Craft uses `versioning.policy`. See [Versioning](https://craft.sentry.dev/pr-preview/pr-939/versioning.md#choosing-the-next-version).

| Option | Description |
| --- | --- |
| `-r`, `--rev` | Source revision (git SHA or tag) to prepare from, if not the branch head. |
| `--no-push` | Don’t push the release branch. |
| `--no-git-checks` | Ignore local git changes and unsynchronized remotes. |
| `--no-changelog` | Don’t check for changelog entries. |
| `--publish` | Run `craft publish` right after a successful prepare. |
| `--remote` | Git remote to push to. Default: `origin`. |
| `--config-from` | Load `.craft.yml` from this remote branch instead of the local file. |

## craft publish

Waits for CI, downloads artifacts, publishes to targets, and merges the release branch. See [Release Workflow → Publish](https://craft.sentry.dev/pr-preview/pr-939/release-workflow.md#publish).

| Option | Description |
| --- | --- |
| `-t`, `--target` | Publish only to this target ID, as listed by `craft targets` (for example `npm` or `registry[browser]`). Also accepts `all` (default) and `none`. |
| `-r`, `--rev` | Source revision (git SHA or tag) to publish, if not the release branch head. |
| `-m`, `--merge-target` | Branch to merge into. Defaults to the repository’s default branch. |
| `--remote` | Git remote to use. Default: `origin`. |
| `--no-merge` | Don’t merge the release branch after publishing. |
| `--keep-branch` | Don’t delete the release branch after merging it. |
| `--keep-downloads` | Keep downloaded artifacts. |
| `--no-status-check` | Don’t wait for the build status. |
| `--no-git-checks` | Ignore local git changes and unsynchronized remotes. |

## craft changelog

Prints the changelog for unreleased changes without preparing a release. See [Changelogs → Previewing a changelog](https://craft.sentry.dev/pr-preview/pr-939/changelogs.md#previewing-a-changelog).

| Option | Description |
| --- | --- |
| `-s`, `--since` | Base revision (tag or SHA). Defaults to the latest tag. |
| `--pr` | Include this unmerged pull request, highlighted. |
| `-f`, `--format` | `text` (default) or `json`. JSON includes the suggested bump type and commit stats. |

## craft targets

Prints the IDs of the configured targets as a JSON array, after expanding npm and NuGet package workspaces into one target per package. Use it to check which targets `craft publish` will run.

## craft config

Prints the parsed, processed, and validated configuration for the current project as JSON. With `--workspace`, prints the resolved configuration for that workspace.

## craft artifacts

Inspects the artifacts the [artifact provider](https://craft.sentry.dev/pr-preview/pr-939/release-workflow.md#artifact-provider) finds for a revision. Both subcommands require `-r`/`--rev`.

```shell
craft artifacts list -r <sha>
craft artifacts download -r <sha> [NAME..]
```

## Navigation

- [Docs home](https://craft.sentry.dev/pr-preview/pr-939/index.md)
- [Previous: Configuration](https://craft.sentry.dev/pr-preview/pr-939/configuration.md)
- [Next: Contributing](https://craft.sentry.dev/pr-preview/pr-939/contributing.md)
