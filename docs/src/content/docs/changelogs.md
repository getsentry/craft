---
title: Changelogs
description: Check, generate, and customize changelogs with Craft
---

Craft keeps a Markdown changelog (`CHANGELOG.md` by default) and uses it for
release notes, such as the body of a [GitHub release](../targets/github/). Pick
a policy:

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

Auto mode uses `.github/release.yml` to categorize PRs. This file follows [GitHub's release.yml format](https://docs.github.com/en/repositories/releasing-projects-on-github/automatically-generated-release-notes#configuring-automatically-generated-release-notes) with Craft-specific extensions.

See [AI summaries](../ai-summaries/) to add generated overviews on top of
automatic changelogs.

## Categories

In auto mode, Craft sorts entries into categories defined in
`.github/release.yml`. Without that file, it uses the
[default categories](#default-categories).

### Craft extensions to release.yml

Craft extends GitHub's format with two additional fields:

| Field             | Description                                                               |
| ----------------- | ------------------------------------------------------------------------- |
| `commit_patterns` | Array of regex patterns to match commit/PR titles (in addition to labels) |
| `semver`          | Version bump type for auto-versioning: `major`, `minor`, or `patch`       |

:::caution[Required for Version Detection]
The `semver` field is required for Craft's automatic version detection to work.
If you define a custom `.github/release.yml` without `semver` fields, PRs will
still appear in the changelog but won't contribute to suggested version bumps.
The [changelog preview](../github-actions/#changelog-preview) will show "None" for semver impact.
:::

### Default categories

If `.github/release.yml` doesn't exist, Craft uses these defaults based on [Conventional Commits](https://www.conventionalcommits.org/):

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

### Example categories

```yaml
changelog:
  categories:
    - title: Features
      labels:
        - enhancement
      commit_patterns:
        - "^(?<type>feat(?:\\((?<scope>[^)]+)\\))?!?:\\s*)"
      semver: minor
    - title: Bug Fixes
      labels:
        - bug
      commit_patterns:
        - "^(?<type>fix(?:\\((?<scope>[^)]+)\\))?!?:\\s*)"
      semver: patch
```

## Custom entries from PR descriptions

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

### Advanced features

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

## Scope grouping

Changes are automatically grouped by scope (e.g., `feat(api):` groups under "Api"):

```yaml
changelog:
  policy: auto
  scopeGrouping: true # default
```

Scope headers are only shown for scopes with more than one entry. Entries without
a scope are listed at the bottom of each category section without a sub-header.

Example output with scope grouping:

```text
### New Features

#### Api

- Add user endpoint by @alice in [#1](https://github.com/...)
- Add auth endpoint by @bob in [#2](https://github.com/...)

#### Ui

- Add dashboard by @charlie in [#3](https://github.com/...)

- General improvement by @dave in [#4](https://github.com/...)
```

## Title stripping

By default, conventional commit prefixes are stripped from changelog entries.
The type (e.g., `feat:`) is removed, and the scope is preserved when entries
aren't grouped under a scope header.

This behavior is controlled by named capture groups in `commit_patterns`:

- `(?<type>...)` - The type prefix to strip (includes type, scope, and colon)
- `(?<scope>...)` - Scope to preserve when not under a scope header

| Original Title            | Scope Header | Displayed Title      |
| ------------------------- | ------------ | -------------------- |
| `feat(api): add endpoint` | Yes (Api)    | `Add endpoint`       |
| `feat(api): add endpoint` | No           | `(api) Add endpoint` |
| `feat: add endpoint`      | N/A          | `Add endpoint`       |

To disable stripping, provide custom patterns using non-capturing groups:

```yaml
commit_patterns:
  - "^feat(?:\\([^)]+\\))?!?:" # No named groups = no stripping
```

## Skipping entries

You can exclude PRs or commits from the changelog in several ways:

### Magic word

Add `#skip-changelog` anywhere in your commit message or PR body:

```
chore: Update dependencies

#skip-changelog
```

### Skip label

PRs with the `skip-changelog` label are automatically excluded.

### Exclusion rules

Configure exclusions in `.github/release.yml`:

```yaml
changelog:
  exclude:
    labels:
      - skip-changelog
      - dependencies
    authors:
      - dependabot[bot]
      - renovate[bot]
```

## Previewing a changelog

Generate a changelog from git history without preparing a release. This is useful for previewing what would be included in a release or for CI integrations.

```shell
craft changelog

Generate changelog from git history

Options:
  --since, -s    Base revision (tag or SHA) to generate from. Defaults to latest tag.
  --pr           PR number for the current (unmerged) PR to include with highlighting.
  --format, -f   Output format: text (default) or json
```

Examples:

```shell
# Generate changelog since last tag
craft changelog

# Generate changelog since specific commit
craft changelog --since 2b58d3c

# Get detailed JSON output including bump type and commit stats
craft changelog --format json
```

:::note
This command requires `GITHUB_TOKEN` to fetch PR information from GitHub.
:::

## Monorepos

When you release several products from one repository with
[release workspaces](../workspaces/), automatic changelogs only include commits
that touch the selected workspace. See
[Workspace-aware changelogs](../workspaces/#workspace-aware-changelogs).

## Configuration options

| Option                    | Description                                                                  |
| ------------------------- | ---------------------------------------------------------------------------- |
| `changelog`               | Path to changelog file (string) OR configuration object                      |
| `changelog.filePath`      | Path to changelog file. Defaults to `<workspace>/CHANGELOG.md` for a directory workspace, otherwise `CHANGELOG.md`. Explicit paths take precedence. |
| `changelog.policy`        | Mode: `none`, `simple`, or `auto`. Default: `none`                           |
| `changelog.scopeGrouping` | Enable scope-based grouping. Default: `true`                                 |
| `changelog.includePaths`  | Extra workspace directories to include in automatic changelogs. [Release workspaces](../workspaces/#workspace-aware-changelogs) only. Default: `[]` |
| `changelog.unownedPaths`  | `include`, `exclude`, or `own` files outside every workspace. [Release workspaces](../workspaces/#workspace-aware-changelogs) only. Default: `include` |
| `changelog.aiSummary` | Opt-in release, category, and scope [AI summaries](../ai-summaries/). Default: disabled. |

The legacy top-level `changelogPolicy` key still works but is deprecated; use
`changelog.policy`.
