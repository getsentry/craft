---
title: Unity Package Manager
description: Publish Unity packages
---

Pulls a package as a zipped artifact and pushes the unzipped content to a target repository, tagging it with the release version.

:::caution
The destination repository will be completely overwritten.
:::

## Configuration

| Option | Description |
|--------|-------------|
| `releaseRepoOwner` | Owner of the release target repository |
| `releaseRepoName` | Name of the release target repository |

## Example

```yaml
targets:
  - name: upm
    releaseRepoOwner: 'getsentry'
    releaseRepoName: 'unity'
```
