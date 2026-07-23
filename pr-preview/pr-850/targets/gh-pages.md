---
title: "GitHub Pages"
description: "Deploy static sites to GitHub Pages"
url: "https://craft.sentry.dev/pr-preview/pr-850/targets/gh-pages/"
---

# GitHub Pages

Extracts an archive with static assets and pushes them to a git branch for GitHub Pages deployment.

Caution

The destination branch will be completely overwritten by the archive contents.

## Configuration

| Option | Description |
| --- | --- |
| `branch` | Branch to push to. Default: `gh-pages` |
| `githubOwner` | GitHub project owner. Default: from global config |
| `githubRepo` | GitHub project name. Default: from global config |

## Default Behavior

By default, this target:

1. Looks for an artifact named `gh-pages.zip`
2. Extracts its contents
3. Commits to the `gh-pages` branch

## Example

```yaml
targets:
  - name: gh-pages
    branch: gh-pages
```


## Workflow

1. Create a `gh-pages.zip` artifact in your CI workflow
2. Configure the target in `.craft.yml`
3. Enable GitHub Pages in repository settings to serve from the `gh-pages` branch

## Navigation

- [Docs home](https://craft.sentry.dev/pr-preview/pr-850/index.md)
- [Parent: Targets Overview](https://craft.sentry.dev/pr-preview/pr-850/targets.md)
- [Previous: Ruby Gems](https://craft.sentry.dev/pr-preview/pr-850/targets/gem.md)
- [Next: GitHub](https://craft.sentry.dev/pr-preview/pr-850/targets/github.md)
