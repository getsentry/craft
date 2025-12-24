---
title: Configuration
description: Complete reference for .craft.yml configuration
---

Project configuration for Craft is stored in `.craft.yml` in the project root.

## GitHub Project

Craft tries to determine GitHub repo information from the local git repo. You can also hard-code it:

```yaml
github:
  owner: getsentry
  repo: sentry-javascript
```

## Pre-release Command

This command runs on your release branch as part of `craft prepare`. Default: `bash scripts/bump-version.sh`.

```yaml
preReleaseCommand: bash scripts/bump-version.sh
```

The script should:
- Accept old and new version as the last two arguments
- Replace version occurrences
- Not commit changes
- Not change git state

Example script:

```bash
#!/bin/bash
set -eux
OLD_VERSION="${1}"
NEW_VERSION="${2}"

export npm_config_git_tag_version=false
npm version "${NEW_VERSION}"
```

## Post-release Command

This command runs after a successful `craft publish`. Default: `bash scripts/post-release.sh`.

```yaml
postReleaseCommand: bash scripts/post-release.sh
```

## Release Branch Name

Override the release branch prefix. Default: `release`.

```yaml
releaseBranchPrefix: publish
```

Full branch name: `{releaseBranchPrefix}/{version}`

## Changelog Policies

Craft supports `simple` and `auto` changelog management modes.

### Simple Mode

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

### Auto Mode

Automatically generates changelog from commits:

```yaml
changelog:
  policy: auto
```

Auto mode uses `.github/release.yml` to categorize PRs by labels or commit patterns. If not present, it uses default [Conventional Commits](https://www.conventionalcommits.org/) patterns:

| Category | Pattern |
|----------|---------|
| Breaking Changes | `^\w+(\(\w+\))?!:` |
| Build / dependencies | `^(build\|ref\|chore\|ci)(\(\w+\))?:` |
| Bug Fixes | `^fix(\(\w+\))?:` |
| Documentation | `^docs?(\(\w+\))?:` |
| New Features | `^feat(\(\w+\))?:` |

Example `.github/release.yml`:

```yaml
changelog:
  categories:
    - title: Features
      labels:
        - enhancement
      commit_patterns:
        - "^feat(\\(\\w+\\))?:"
    - title: Bug Fixes
      labels:
        - bug
      commit_patterns:
        - "^fix(\\(\\w+\\))?:"
```

### Scope Grouping

Changes are automatically grouped by scope (e.g., `feat(api):` groups under "Api"):

```yaml
changelog:
  policy: auto
  scopeGrouping: true  # default
```

### Configuration Options

| Option | Description |
|--------|-------------|
| `changelog` | Path to changelog file (string) OR configuration object |
| `changelog.filePath` | Path to changelog file. Default: `CHANGELOG.md` |
| `changelog.policy` | Mode: `none`, `simple`, or `auto`. Default: `none` |
| `changelog.scopeGrouping` | Enable scope-based grouping. Default: `true` |

## Minimal Version

Require a minimum Craft version:

```yaml
minVersion: '0.5.0'
```

## Required Files

Ensure specific artifacts exist before publishing:

```yaml
requireNames:
  - /^sentry-craft.*\.tgz$/
  - /^gh-pages.zip$/
```

## Status Provider

Configure build status checks:

```yaml
statusProvider:
  name: github
  config:
    contexts:
      - Travis CI - Branch
```

## Artifact Provider

Configure where to fetch artifacts from:

```yaml
artifactProvider:
  name: github  # or 'gcs' or 'none'
```

## Targets

List release targets in your configuration:

```yaml
targets:
  - name: npm
  - name: github
  - name: registry
    id: browser
    type: sdk
    onlyIfPresent: /^sentry-browser-.*\.tgz$/
```

See [Target Configurations](./targets/) for details on each target.

### Per-target Options

These options apply to all targets:

| Option | Description |
|--------|-------------|
| `includeNames` | Regex: only matched files are processed |
| `excludeNames` | Regex: matched files are skipped |
| `id` | Unique ID for the target (use with `-t target[id]`) |

Example:

```yaml
targets:
  - name: github
    includeNames: /^.*\.exe$/
    excludeNames: /^test.exe$/
```
