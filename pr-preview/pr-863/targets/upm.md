---
title: "Unity Package Manager"
description: "Publish Unity packages"
url: "https://craft.sentry.dev/pr-preview/pr-863/targets/upm/"
---

# Unity Package Manager

Pulls a package as a zipped artifact and pushes the unzipped content to a target repository, tagging it with the release version.

Caution

The destination repository will be completely overwritten.

## Configuration

| Option | Description |
| --- | --- |
| `releaseRepoOwner` | Owner of the release target repository |
| `releaseRepoName` | Name of the release target repository |

## Example

```yaml
targets:
  - name: upm
    releaseRepoOwner: 'getsentry'
    releaseRepoName: 'unity'
```

## Navigation

- [Docs home](https://craft.sentry.dev/pr-preview/pr-863/index.md)
- [Parent: Targets Overview](https://craft.sentry.dev/pr-preview/pr-863/targets.md)
- [Previous: Symbol Collector](https://craft.sentry.dev/pr-preview/pr-863/targets/symbol-collector.md)
