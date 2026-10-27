---
title: "Configuration Reference"
description: "Every .craft.yml setting at a glance"
url: "https://craft.sentry.dev/pr-preview/pr-938/configuration/"
---

# Configuration Reference

Craft reads its project configuration from `.craft.yml`, searching the current directory and then its parents. Run `craft config` to print the parsed and validated result.

```yaml
minVersion: '2.29.0'
github:
  owner: getsentry
  repo: sentry-javascript
changelog:
  policy: auto
versioning:
  policy: auto
targets:
  - name: npm
  - name: github
```


## Top-level settings

| Setting | Description | Guide |
| --- | --- | --- |
| [`minVersion`](#minversion) | Minimum Craft version required. Also gates newer behavior. |  |
| [`github`](#github) | Repository owner and name. Detected from the git remote by default. |  |
| `targets` | Where to publish. List of target configurations. | [Targets](https://craft.sentry.dev/pr-preview/pr-938/targets.md) |
| `changelog` | Changelog file path, policy, scope grouping, and AI summaries. | [Changelogs](https://craft.sentry.dev/pr-preview/pr-938/changelogs.md) |
| `versioning` | How the next version is chosen: `auto`, `manual`, or `calver`. | [Versioning](https://craft.sentry.dev/pr-preview/pr-938/versioning.md#versioning-policies) |
| `preReleaseCommand` | Command that bumps versions during `craft prepare`. | [Release Workflow](https://craft.sentry.dev/pr-preview/pr-938/release-workflow.md#pre-release-command) |
| `postReleaseCommand` | Command that runs after `craft publish`. | [Release Workflow](https://craft.sentry.dev/pr-preview/pr-938/release-workflow.md#post-release-command) |
| `releaseBranchPrefix` | Release branch prefix. Default: `release`. | [Release Workflow](https://craft.sentry.dev/pr-preview/pr-938/release-workflow.md#release-branch-name) |
| `statusProvider` | How Craft checks that CI passed. | [Release Workflow](https://craft.sentry.dev/pr-preview/pr-938/release-workflow.md#status-provider) |
| `artifactProvider` | Where Craft downloads build artifacts from. | [Release Workflow](https://craft.sentry.dev/pr-preview/pr-938/release-workflow.md#artifact-provider) |
| `requireNames` | Artifacts that must exist before publishing. | [Release Workflow](https://craft.sentry.dev/pr-preview/pr-938/release-workflow.md#required-files) |
| `noMerge` | Don’t merge the release branch after publishing. | [Release Workflow](https://craft.sentry.dev/pr-preview/pr-938/release-workflow.md#merging-the-release-branch) |
| `workspaces` | Independently versioned release units in one repository. | [Monorepos & Release Workspaces](https://craft.sentry.dev/pr-preview/pr-938/workspaces.md) |
| `changelogPolicy` | Deprecated. Use `changelog.policy`. |  |

Inside `workspaces`, each release unit accepts the same settings except `minVersion` and `workspaces`. See [Inheritance](https://craft.sentry.dev/pr-preview/pr-938/workspaces.md#inheritance).

## minVersion

Require a minimum Craft version:

```yaml
minVersion: '2.29.0'
```


Several features only turn on at or above a given `minVersion`, so older projects keep their behavior when Craft is upgraded:

| `minVersion` | Enables |
| --- | --- |
| `2.14.0` | Bump types, `auto`, and `calver` versions; `versioning.policy` defaults to `auto`. |
| `2.21.0` | [Automatic version bumping](https://craft.sentry.dev/pr-preview/pr-938/versioning.md#automatic-version-bumping) when no `preReleaseCommand` is set. |
| `2.29.0` | [Release workspaces](https://craft.sentry.dev/pr-preview/pr-938/workspaces.md). |

## github

Craft tries to determine GitHub repo information from the local git repo. You can also hard-code it:

```yaml
github:
  owner: getsentry
  repo: sentry-javascript
```


## Moved sections

Older links, including the ones printed by earlier Craft versions, point to these anchors. The topics now have their own pages.

### Auto mode

See [Changelogs → Auto mode](https://craft.sentry.dev/pr-preview/pr-938/changelogs.md#auto-mode) and [Categories](https://craft.sentry.dev/pr-preview/pr-938/changelogs.md#categories) for `semver` fields.

### AI summaries

See [AI Changelog Summaries](https://craft.sentry.dev/pr-preview/pr-938/ai-summaries.md).

## Navigation

- [Docs home](https://craft.sentry.dev/pr-preview/pr-938/index.md)
- [Previous: GitHub Actions](https://craft.sentry.dev/pr-preview/pr-938/github-actions.md)
- [Next: CLI](https://craft.sentry.dev/pr-preview/pr-938/cli.md)
