---
title: "Release Workflow"
description: "What craft prepare and craft publish do, and how to customize each step"
url: "https://craft.sentry.dev/pr-preview/pr-942/release-workflow/"
---

# Release Workflow

Every Craft release moves through the same stages:

```txt
craft prepare ──► release branch ──► CI builds artifacts ──► craft publish ──► targets
                                                                     └──► merge back
```


This page walks through each stage and the configuration that controls it. For a first-time setup, start with the [Quick Start](https://craft.sentry.dev/pr-preview/pr-942/getting-started.md).

## Prepare

`craft prepare [NEW-VERSION]` runs locally or in CI and:

1. Resolves the new version: an explicit version, a bump type, `auto`, or
   `calver`. See [Versioning](https://craft.sentry.dev/pr-preview/pr-942/versioning.md).
2. Creates the release branch `{releaseBranchPrefix}/{version}` from the
   current branch head (or `--rev`).
3. Runs the [pre-release command](#pre-release-command) or Craft’s
   [automatic version bumping](https://craft.sentry.dev/pr-preview/pr-942/versioning.md#automatic-version-bumping).
4. Checks or generates the changelog according to the
   [changelog policy](https://craft.sentry.dev/pr-preview/pr-942/changelogs.md).
5. Commits the changes and pushes the release branch (skip with `--no-push`).

Pass `--publish` to run `craft publish` right after a successful prepare. See the [CLI reference](https://craft.sentry.dev/pr-preview/pr-942/cli.md#craft-prepare) for every flag.

### Release branch name

Release branches are named `{releaseBranchPrefix}/{version}`. The default prefix is `release`:

```yaml
releaseBranchPrefix: publish
```


The prefix may contain slashes, such as `release/cli`. That keeps branches for independently versioned products apart; see [Monorepos & Release Workspaces](https://craft.sentry.dev/pr-preview/pr-942/workspaces.md).

### Pre-release command

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


## Build

Pushing the release branch triggers your CI. CI must build the release artifacts and upload them somewhere the [artifact provider](#artifact-provider) can find them. Craft does not build anything itself.

## Publish

`craft publish NEW-VERSION` finds the release branch for the version, then:

1. Waits for the [status provider](#status-provider) to report a successful
   build (skip with `--no-status-check`).
2. Downloads the artifacts through the [artifact provider](#artifact-provider)
   and checks [required files](#required-files).
3. Runs each configured [target](https://craft.sentry.dev/pr-preview/pr-942/targets.md) in the order they are listed.
4. Merges the release branch into the merge target and deletes it (see
   [Merging the release branch](#merging-the-release-branch)).
5. Runs the [post-release command](#post-release-command).

Limit a run to specific targets with `-t`:

```shell
craft publish 1.2.3 -t npm              # only npm
craft publish 1.2.3 -t registry[browser] # a target with an id
craft publish 1.2.3 -t none             # skip targets, just merge
```


When you publish to specific targets, Craft doesn’t merge the release branch. Run `craft publish 1.2.3 -t none` once every target is done.

See the [CLI reference](https://craft.sentry.dev/pr-preview/pr-942/cli.md#craft-publish) for every flag.

### Status provider

Before publishing, Craft waits for CI on the release commit to finish. By default, the `github` status provider combines every commit status and check run on that commit. List `contexts` to only wait for specific checks:

```yaml
statusProvider:
  name: github
  config:
    contexts:
      - Travis CI - Branch
```


### Artifact provider

The artifact provider is where Craft downloads the files your CI built. The default is `github` (GitHub Actions artifacts). Use `gcs` for Google Cloud Storage, or `none` when your targets don’t need artifacts:

```yaml
artifactProvider:
  name: github # or 'gcs' or 'none'
```


By default, the GitHub artifact provider looks for artifacts named exactly as the commit SHA. You can customize this with the `artifacts` configuration option.

#### Pattern syntax

- **Regex patterns**: Wrapped in `/` (e.g., `/^build-.*$/`)
- **Exact strings**: Plain text (e.g., `build`, `release-artifacts`)

#### Configuration formats

**1. Single artifact pattern** - searches all workflows:

```yaml
artifactProvider:
  name: github
  config:
    artifacts: /^sentry-.*\.tgz$/
```


**2. Multiple artifact patterns** - searches all workflows:

```yaml
artifactProvider:
  name: github
  config:
    artifacts:
      - /^sentry-.*\.tgz$/
      - release-bundle
```


**3. Workflow-scoped patterns** - filter by workflow name:

```yaml
artifactProvider:
  name: github
  config:
    artifacts:
      build: release-artifacts # exact workflow → exact artifact
      /^build-.*$/: artifacts # workflow pattern → exact artifact
      ci: # exact workflow → multiple artifacts
        - /^output-.*$/
        - bundle
      /^release-.*$/: # workflow pattern → multiple artifacts
        - /^dist-.*$/
        - checksums
```


#### Common examples

Fetch artifacts named `craft-binary` and `craft-docs` from the “Build & Test” workflow:

```yaml
artifactProvider:
  name: github
  config:
    artifacts:
      Build & Test:
        - craft-binary
        - craft-docs
```


Fetch all `.tgz` files from any workflow:

```yaml
artifactProvider:
  name: github
  config:
    artifacts: /\.tgz$/
```


#### Backward compatibility

When `artifacts` is not configured, the provider uses the legacy behavior where it searches for an artifact with a name matching the commit SHA exactly. This ensures existing configurations continue to work without changes.

### Required files

Ensure specific artifacts exist before publishing:

```yaml
requireNames:
  - /^sentry-craft.*\.tgz$/
  - /^gh-pages.zip$/
```


### Merging the release branch

After publishing, Craft merges the release branch into the merge target and deletes the branch. The merge target defaults to the repository’s default branch; override it with `--merge-target`.

- `--no-merge` skips the merge. `--keep-branch` merges but keeps the branch.
- Set `noMerge: true` in `.craft.yml` to never merge. Craft turns this on
  automatically for compiled Node.js GitHub Actions (repositories with a
  `dist/` folder), unless `noMerge` is set explicitly.

### Post-release command

This command runs after a successful `craft publish`. Default: `bash scripts/post-release.sh`.

```yaml
postReleaseCommand: bash scripts/post-release.sh
```


The released version is available as `CRAFT_RELEASED_VERSION`. Unlike the pre-release command, this command handles its own git operations, so it can commit and push changes such as a development version bump. If the default script doesn’t exist, Craft skips this step; set `postReleaseCommand: ''` to skip it explicitly.

## Remote

Craft pushes to and reads from the `origin` remote by default. Use `--remote` or set `CRAFT_REMOTE` to use a different one.

## Recovering from a failed prepare

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

## Navigation

- [Docs home](https://craft.sentry.dev/pr-preview/pr-942/index.md)
- [Previous: Quick Start](https://craft.sentry.dev/pr-preview/pr-942/getting-started.md)
- [Next: Versioning](https://craft.sentry.dev/pr-preview/pr-942/versioning.md)
