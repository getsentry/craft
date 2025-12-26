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

### Custom Changelog Entries from PR Descriptions

By default, the changelog entry for a PR is generated from its title. However,
PR authors can override this by adding a "Changelog Entry" section to the PR
description. This allows for more detailed, user-facing changelog entries without
cluttering the PR title.

To use this feature, add a markdown heading (level 2 or 3) titled "Changelog Entry"
to your PR description, followed by the desired changelog text:

```markdown
### Description

Add `foo` function, and add unit tests to thoroughly check all edge cases.

### Changelog Entry

Add a new function called `foo` which prints "Hello, world!"

### Issues

Closes #123
```

The text under "Changelog Entry" will be used verbatim in the changelog instead
of the PR title. If no such section is present, the PR title is used as usual.

#### Advanced Features

1. **Multiple Entries**: If you use multiple top-level bullet points in the
   "Changelog Entry" section, each bullet will become a separate changelog entry:

   ```markdown
   ### Changelog Entry

   - Add OAuth2 authentication
   - Add two-factor authentication
   - Add session management
   ```

2. **Nested Content**: Indented bullets (4+ spaces or tabs) are preserved as
   nested content under their parent entry:

   ```markdown
   ### Changelog Entry

   - Add authentication system
       - OAuth2 support
       - Two-factor authentication
       - Session management
   ```

   This will generate:
   ```markdown
   - Add authentication system by @user in [#123](url)
     - OAuth2 support
     - Two-factor authentication
     - Session management
   ```

   Note: Nested items do NOT get author/PR attribution - only the top-level entry does.

3. **Plain Text**: If no bullets are used, the entire content is treated as a
   single changelog entry. Multi-line text is automatically joined with spaces
   to ensure valid markdown output.

4. **Content Isolation**: Only content within the "Changelog Entry" section is
   included in the changelog. Other sections (Description, Issues, etc.) are
   ignored.

### Scope Grouping

Changes are automatically grouped by scope (e.g., `feat(api):` groups under "Api"):

```yaml
changelog:
  policy: auto
  scopeGrouping: true  # default
```

Scope headers are only shown for scopes with more than one entry. Entries without
a scope are listed at the bottom of each category section without a sub-header.

Example output with scope grouping:

```text
### New Features

#### Api

- feat(api): add user endpoint by @alice in [#1](https://github.com/...)
- feat(api): add auth endpoint by @bob in [#2](https://github.com/...)

#### Ui

- feat(ui): add dashboard by @charlie in [#3](https://github.com/...)

- feat: general improvement by @dave in [#4](https://github.com/...)
```

### Configuration Options

| Option | Description |
|--------|-------------|
| `changelog` | Path to changelog file (string) OR configuration object |
| `changelog.filePath` | Path to changelog file. Default: `CHANGELOG.md` |
| `changelog.policy` | Mode: `none`, `simple`, or `auto`. Default: `none` |
| `changelog.scopeGrouping` | Enable scope-based grouping. Default: `true` |

## Versioning

Configure default versioning behavior:

```yaml
versioning:
  policy: auto  # auto, manual, or calver
```

### Versioning Policies

| Policy | Description |
|--------|-------------|
| `auto` | Analyze commits to determine version bump (default when using `craft prepare auto`) |
| `manual` | Require explicit version argument |
| `calver` | Use calendar-based versioning |

### Calendar Versioning (CalVer)

For projects using calendar-based versions:

```yaml
versioning:
  policy: calver
  calver:
    format: "%y.%-m"  # e.g., 24.12 for December 2024
    offset: 14        # Days to look back for date calculation
```

Format supports:
- `%y` - 2-digit year
- `%m` - Zero-padded month
- `%-m` - Month without padding

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
