---
title: "Quick Start"
description: "Set up a project for Craft and ship your first release"
url: "https://craft.sentry.dev/pr-preview/pr-934/getting-started/"
---

# Quick Start

Craft releases happen in two steps:

1. **`craft prepare`** creates a release branch, bumps versions, checks or
   generates the changelog, and pushes the branch. Your CI builds release artifacts from it.
2. **`craft publish`** waits for CI to pass, downloads those artifacts, and
   publishes them to every configured [target](https://craft.sentry.dev/pr-preview/pr-934/targets.md), then merges the
   release branch back.

See [Release Workflow](https://craft.sentry.dev/pr-preview/pr-934/release-workflow.md) for what happens at each step.

## Installation

Install the CLI with one command (macOS, Linux, or Windows x64 via Git Bash):

```bash
curl -fsSL https://craft.sentry.dev/install | bash
```


See [Installation](https://craft.sentry.dev/pr-preview/pr-934/installation.md) for Homebrew, standalone binaries, npm, updates, and shell completion. In GitHub Actions, the [Craft Action](https://craft.sentry.dev/pr-preview/pr-934/github-actions.md) installs Craft for you.

Craft talks to GitHub for almost everything, so export a `GITHUB_TOKEN` with `repo` scope before running it locally. See [CLI → GitHub token](https://craft.sentry.dev/pr-preview/pr-934/cli.md#github-token).

## Integrate your project

1. **Build release branches in CI.** Make sure your build workflow runs on release branches:

   ```yaml
   on:
     push:
       branches:
         - 'release/**'
   ```
2. **Upload build artifacts** named after the commit SHA, which is what the default [GitHub artifact provider](https://craft.sentry.dev/pr-preview/pr-934/release-workflow.md#artifact-provider) looks for:

   ```yaml
   - name: Archive Artifacts
     uses: actions/upload-artifact@v4
     with:
       name: ${{ github.sha }}
       path: |
         ${{ github.workspace }}/*.tgz
   ```
3. **Add `.craft.yml`** to the repository root with your targets:

   ```yaml
   minVersion: '2.21.0'
   changelog:
     policy: auto
   targets:
     - name: github
     - name: npm
   ```


See the [configuration reference](https://craft.sentry.dev/pr-preview/pr-934/configuration.md) for every option.
4. **Set up version bumping.** With `minVersion: '2.21.0'` or later, Craft [bumps versions automatically](https://craft.sentry.dev/pr-preview/pr-934/versioning.md#automatic-version-bumping) based on your targets. Otherwise, add `scripts/bump-version.sh` or set a custom [`preReleaseCommand`](https://craft.sentry.dev/pr-preview/pr-934/release-workflow.md#pre-release-command).
5. **Provide credentials** for your targets as environment variables (for example `NPM_TOKEN`). Each [target page](https://craft.sentry.dev/pr-preview/pr-934/targets.md) lists what it needs.

## Ship a release

Let’s release version `1.2.3`:

```shell
craft prepare 1.2.3
```


This creates the `release/1.2.3` branch, bumps versions, commits the changes, and pushes the branch. CI builds and uploads the artifacts.

```shell
craft publish 1.2.3
```


This finds the release branch, waits for CI to pass, downloads the artifacts, publishes them to your targets (for example GitHub and npm), and merges the branch back into your default branch.

You can let Craft choose the version from your commit history instead:

```shell
craft prepare auto   # or major, minor, patch
```


Or do both steps at once with `craft prepare 1.2.3 --publish`.

Tip

Run any command with `--dry-run` to see what would change without pushing or calling mutating GitHub APIs. See [Dry-run mode](https://craft.sentry.dev/pr-preview/pr-934/cli.md#dry-run-mode).

## Next steps

- [Automate releases with GitHub Actions](https://craft.sentry.dev/pr-preview/pr-934/github-actions.md)
- [Generate changelogs from your commits](https://craft.sentry.dev/pr-preview/pr-934/changelogs.md)
- [Release several products from one repository](https://craft.sentry.dev/pr-preview/pr-934/workspaces.md)
- [Browse all targets](https://craft.sentry.dev/pr-preview/pr-934/targets.md)

## Navigation

- [Docs home](https://craft.sentry.dev/pr-preview/pr-934/index.md)
- [Previous: Installation](https://craft.sentry.dev/pr-preview/pr-934/installation.md)
- [Next: Release Workflow](https://craft.sentry.dev/pr-preview/pr-934/release-workflow.md)
