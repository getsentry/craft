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

## Preview Releases

If `previewReleases` is `true` (default), releases containing pre-release identifiers like `alpha`, `beta`, `rc`, etc. are marked as pre-releases on GitHub.
