---
title: Commit on Git Repository
description: Push unpacked tarball contents to a git repository
---

Takes a tarball and pushes the unpacked contents to a git repository.

## Configuration

| Option | Description |
|--------|-------------|
| `archive` | Regex to match a `.tgz` file in artifacts (must match exactly one) |
| `repositoryUrl` | Git remote URL (must use http or https, not `git@...`) |
| `branch` | Target branch |
| `stripComponents` | Leading path elements to remove when unpacking. Default: `0` |
| `createTag` | Create a tag with the release version. Default: `false` |

## Environment Variables

| Name | Description |
|------|-------------|
| `GITHUB_API_TOKEN` | GitHub PAT for authentication (when host is `github.com`) |

## Example

```yaml
targets:
  - name: commit-on-git-repository
    archive: /^sentry-deno-\d.*\.tgz$/
    repositoryUrl: https://github.com/getsentry/sentry-deno
    stripComponents: 1
    branch: main
    createTag: true
```

## Notes

- The repository URL must use HTTP or HTTPS protocol
- For GitHub repos, authentication uses `GITHUB_API_TOKEN`
