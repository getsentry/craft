---
title: "GitHub"
description: "Create GitHub releases and tags"
url: "https://craft.sentry.dev/targets/github/"
---

# GitHub

Creates a git tag and a GitHub release for the version, and uploads matching artifacts as release assets. If a Markdown changelog is present, this target reads the release name and description from it.

## Configuration

| Option | Description |
| --- | --- |
| `tagPrefix` | Prefix for new git tags (e.g., `v`). Empty by default. |
| `previewReleases` | Automatically detect and create preview releases. Default: `true` |
| `tagOnly` | Only create a tag (without a GitHub release). Default: `false` |
| `floatingTags` | List of floating tags to create/update. Supports `{major}`, `{minor}`, `{patch}` placeholders. |

The repository itself comes from the top-level [`github`](https://craft.sentry.dev/configuration.md#github) setting or your git remote, not from this target.

## Environment Variables

| Name | Description |
| --- | --- |
| `GITHUB_TOKEN` | Personal GitHub API token ([create one](https://github.com/settings/tokens)) |

## Example

```yaml
targets:
  - name: github
    tagPrefix: v
    previewReleases: true
```


## Tag Prefixes

`tagPrefix` is prepended to every tag this target creates: `tagPrefix: v` turns version `1.2.3` into tag `v1.2.3`.

Craft also reads the prefix from the first `github` target when it looks up previous releases, so latest-tag detection, the changelog base, and CalVer scans only see tags with that prefix. That is what lets several products share one repository; see [Monorepos & Release Workspaces](https://craft.sentry.dev/workspaces.md).

## Floating Tags

Use `floatingTags` to maintain “latest major version” tags that always point to the most recent release:

```yaml
targets:
  - name: github
    floatingTags:
      - "v{major}"        # Creates v2 for version 2.15.0
      - "v{major}.{minor}" # Creates v2.15 for version 2.15.0
```


This is useful for users who want to pin to a major version while automatically receiving updates.

## Preview Releases

If `previewReleases` is `true` (default), releases containing pre-release identifiers like `alpha`, `beta`, `rc`, etc. are marked as pre-releases on GitHub. See [Versioning](https://craft.sentry.dev/versioning.md#preview-releases) for the identifiers Craft recognizes.

## Release Workspaces

Release workspaces are a Craft-wide feature, not specific to this target. See [Monorepos & Release Workspaces](https://craft.sentry.dev/workspaces.md) for how to configure them.

Inside a workspace, this target prefixes the release title with the tag: a changelog heading of `0.2.0` with `tagPrefix: 'cli@'` produces a release titled `cli@0.2.0`, so releases of different products stay distinguishable. Outside workspaces, the changelog heading is used as-is.

### The “Latest” badge in monorepos

GitHub tracks a single “Latest” release **per repository**, not per tag prefix. Craft decides whether to mark a release as latest by comparing its version against the repository’s current latest release ([`isLatestRelease`](https://github.com/getsentry/craft/blob/master/src/targets/github.ts)), which is not prefix-scoped. In a monorepo this means the “Latest” badge can move between products (e.g. publishing `cli@9.0.0` may take the badge from `mcp@3.0.0`, and publishing `cli@1.2.3` while `mcp@3.0.0` is latest won’t earn the badge). Tags, changelogs, release branches, and version detection remain correctly per-product — only GitHub’s single “Latest” pointer is shared.

## Navigation

- [Docs home](https://craft.sentry.dev/index.md)
- [Parent: Targets Overview](https://craft.sentry.dev/targets.md)
- [Previous: GitHub Pages](https://craft.sentry.dev/targets/gh-pages.md)
- [Next: Hex](https://craft.sentry.dev/targets/hex.md)
