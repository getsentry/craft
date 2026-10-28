---
title: "Changelogs"
description: "Check, generate, and customize changelogs with Craft"
url: "https://craft.sentry.dev/pr-preview/pr-942/changelogs/"
---

# Changelogs

Craft keeps a Markdown changelog (`CHANGELOG.md` by default) and uses it for release notes, such as the body of a [GitHub release](https://craft.sentry.dev/pr-preview/pr-942/targets/github.md). Pick a policy:

| Policy | What Craft does on `craft prepare` |
| --- | --- |
| `none` (default) | Nothing. |
| `simple` | Checks that the changelog has an entry for the new version. |
| `auto` | Generates the entry from merged pull requests and commits. |

## Policies

### Simple mode

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


### Auto mode

Automatically generates changelog from commits:

```yaml
changelog:
  policy: auto
```


Auto mode uses `.github/release.yml` to categorize PRs. This file follows [GitHub’s release.yml format](https://docs.github.com/en/repositories/releasing-projects-on-github/automatically-generated-release-notes#configuring-automatically-generated-release-notes) with Craft-specific extensions.

See [AI summaries](https://craft.sentry.dev/pr-preview/pr-942/ai-summaries.md) to add generated overviews on top of automatic changelogs.

## Categories

In auto mode, Craft sorts entries into categories defined in `.github/release.yml`. Without that file, it uses the [default categories](#default-categories).

### Craft extensions to release.yml

Craft extends GitHub’s format with two additional fields:

| Field | Description |
| --- | --- |
| `commit_patterns` | Array of regex patterns to match commit/PR titles (in addition to labels) |
| `semver` | Version bump type for auto-versioning: `major`, `minor`, or `patch` |

Required for Version Detection

The `semver` field is required for Craft’s automatic version detection to work. If you define a custom `.github/release.yml` without `semver` fields, PRs will still appear in the changelog but won’t contribute to suggested version bumps. The [changelog preview](https://craft.sentry.dev/pr-preview/pr-942/github-actions.md#changelog-preview) will show “None” for semver impact.

### Default categories

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

- [Docs home](https://craft.sentry.dev/pr-preview/pr-942/index.md)
- [Previous: Versioning](https://craft.sentry.dev/pr-preview/pr-942/versioning.md)
- [Next: AI Changelog Summaries](https://craft.sentry.dev/pr-preview/pr-942/ai-summaries.md)
