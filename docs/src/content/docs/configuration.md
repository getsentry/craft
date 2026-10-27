---
title: Configuration Reference
description: Every .craft.yml setting at a glance
---

Craft reads its project configuration from `.craft.yml`, searching the current
directory and then its parents. Run `craft config` to print the parsed and
validated result.

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
| [`minVersion`](#minversion) | Minimum Craft version required. Also gates newer behavior. | |
| [`github`](#github) | Repository owner and name. Detected from the git remote by default. | |
| `targets` | Where to publish. List of target configurations. | [Targets](../targets/) |
| `changelog` | Changelog file path, policy, scope grouping, and AI summaries. | [Changelogs](../changelogs/) |
| `versioning` | How the next version is chosen: `auto`, `manual`, or `calver`. | [Versioning](../versioning/#versioning-policies) |
| `preReleaseCommand` | Command that bumps versions during `craft prepare`. | [Release Workflow](../release-workflow/#pre-release-command) |
| `postReleaseCommand` | Command that runs after `craft publish`. | [Release Workflow](../release-workflow/#post-release-command) |
| `releaseBranchPrefix` | Release branch prefix. Default: `release`. | [Release Workflow](../release-workflow/#release-branch-name) |
| `statusProvider` | How Craft checks that CI passed. | [Release Workflow](../release-workflow/#status-provider) |
| `artifactProvider` | Where Craft downloads build artifacts from. | [Release Workflow](../release-workflow/#artifact-provider) |
| `requireNames` | Artifacts that must exist before publishing. | [Release Workflow](../release-workflow/#required-files) |
| `noMerge` | Don't merge the release branch after publishing. | [Release Workflow](../release-workflow/#merging-the-release-branch) |
| `workspaces` | Independently versioned release units in one repository. | [Monorepos & Release Workspaces](../workspaces/) |
| `changelogPolicy` | Deprecated. Use `changelog.policy`. | |

Inside `workspaces`, each release unit accepts the same settings except
`minVersion` and `workspaces`. See [Inheritance](../workspaces/#inheritance).

## minVersion

Require a minimum Craft version:

```yaml
minVersion: '2.29.0'
```

Several features only turn on at or above a given `minVersion`, so older
projects keep their behavior when Craft is upgraded:

| `minVersion` | Enables |
| --- | --- |
| `2.14.0` | Bump types, `auto`, and `calver` versions; `versioning.policy` defaults to `auto`. |
| `2.21.0` | [Automatic version bumping](../versioning/#automatic-version-bumping) when no `preReleaseCommand` is set. |
| `2.29.0` | [Release workspaces](../workspaces/). |

## github

Craft tries to determine GitHub repo information from the local git repo. You can also hard-code it:

```yaml
github:
  owner: getsentry
  repo: sentry-javascript
```

## Moved sections

Older links, including the ones printed by earlier Craft versions, point to
these anchors. The topics now have their own pages.

### Auto mode

See [Changelogs → Auto mode](../changelogs/#auto-mode) and
[Categories](../changelogs/#categories) for `semver` fields.

### AI summaries

See [AI Changelog Summaries](../ai-summaries/).
