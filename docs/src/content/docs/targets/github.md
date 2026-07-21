---
title: GitHub
description: Create GitHub releases and tags
---

Creates a release on GitHub. If a Markdown changelog is present, this target reads the release name and description from it.

## Configuration

| Option | Description |
|--------|-------------|
| `tagPrefix` | Prefix for new git tags (e.g., `v`). Empty by default. |
| `previewReleases` | Automatically detect and create preview releases. Default: `true` |
| `tagOnly` | Only create a tag (without a GitHub release). Default: `false` |
| `floatingTags` | List of floating tags to create/update. Supports `{major}`, `{minor}`, `{patch}` placeholders. |

## Environment Variables

| Name | Description |
|------|-------------|
| `GITHUB_TOKEN` | Personal GitHub API token ([create one](https://github.com/settings/tokens)) |

## Example

```yaml
targets:
  - name: github
    tagPrefix: v
    previewReleases: true
```

## Floating Tags

Use `floatingTags` to maintain "latest major version" tags that always point to the most recent release:

```yaml
targets:
  - name: github
    floatingTags:
      - "v{major}"        # Creates v2 for version 2.15.0
      - "v{major}.{minor}" # Creates v2.15 for version 2.15.0
```

This is useful for users who want to pin to a major version while automatically receiving updates.

## Monorepo: independently-versioned products

`tagPrefix` lets a single repository host several independently-versioned products by namespacing their git tags — for example `cli@1.2.3` and `mcp@2.0.0`. Craft honors the prefix on both the **write** side (the tag it creates) and the **read** side (latest-tag detection, changelog base, and CalVer scans are all scoped to the prefix), so the products don't cross-contaminate each other's version history.

The intended layout is **one `.craft.yml` per product**, each with a single `github` target declaring its own `tagPrefix` and a matching `releaseBranchPrefix` (so release branches don't collide):

```yaml
# .craft.yml for the CLI product
github:
  owner: getsentry
  repo: toolkit
releaseBranchPrefix: release/cli
targets:
  - name: github
    tagPrefix: "cli@"
```

```yaml
# .craft.yml for the MCP product
github:
  owner: getsentry
  repo: toolkit
releaseBranchPrefix: release/mcp
targets:
  - name: github
    tagPrefix: "mcp@"
```

Releasing `1.2.3` for each product then produces the tags `cli@1.2.3` / `mcp@1.2.3` on release branches `release/cli/1.2.3` / `release/mcp/1.2.3` — no collisions.

:::caution
Declaring **multiple** `github` targets with **different** `tagPrefix` values in a *single* config is ambiguous: Craft uses the first prefix for read-path operations and logs a warning. Use a separate `.craft.yml` per product instead.
:::

:::note[Known limitation: the GitHub "Latest" badge is repo-wide]
GitHub tracks a single "Latest" release **per repository**, not per tag prefix. Craft decides whether to mark a release as latest by comparing its version against the repository's current latest release ([`isLatestRelease`](https://github.com/getsentry/craft/blob/master/src/targets/github.ts)), which is not prefix-scoped. In a monorepo this means the "Latest" badge can move between products (e.g. publishing `cli@9.0.0` may take the badge from `mcp@3.0.0`, and publishing `cli@1.2.3` while `mcp@3.0.0` is latest won't earn the badge). Tags, changelogs, release branches, and version detection remain correctly per-product — only GitHub's single "Latest" pointer is shared.
:::

## Preview Releases

If `previewReleases` is `true` (default), releases containing pre-release identifiers like `alpha`, `beta`, `rc`, etc. are marked as pre-releases on GitHub.
