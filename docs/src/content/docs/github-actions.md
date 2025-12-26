---
title: GitHub Actions
description: Automate releases and changelog previews with Craft GitHub Actions
---

Craft provides GitHub Actions for automating releases and previewing changelog entries in pull requests.

## Prepare Release Action

The main Craft action automates the `craft prepare` workflow in GitHub Actions. It creates a release branch, updates the changelog, and opens a publish request issue.

### Basic Usage

```yaml
name: Release
on:
  workflow_dispatch:
    inputs:
      version:
        description: 'Version to release (or "auto")'
        required: false

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: getsentry/craft@v2
        with:
          version: ${{ github.event.inputs.version }}
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Inputs

| Input | Description | Default |
|-------|-------------|---------|
| `version` | Version to release. Can be a semver string (e.g., "1.2.3"), a bump type ("major", "minor", "patch"), or "auto" for automatic detection. | Uses `versioning.policy` from config |
| `merge_target` | Target branch to merge into. | Default branch |
| `force` | Force a release even when there are release-blockers. | `false` |
| `blocker_label` | Label that blocks releases. | `release-blocker` |
| `publish_repo` | Repository for publish issues (owner/repo format). | `{owner}/publish` |
| `git_user_name` | Git committer name. | GitHub actor |
| `git_user_email` | Git committer email. | Actor's noreply email |
| `path` | The path that Craft will run inside. | `.` |
| `craft_config_from_merge_target` | Use the craft config from the merge target branch. | `false` |

### Outputs

| Output | Description |
|--------|-------------|
| `version` | The resolved version being released |
| `branch` | The release branch name |
| `sha` | The commit SHA on the release branch |
| `previous_tag` | The tag before this release (for diff links) |
| `changelog` | The changelog for this release |

### Auto-versioning Example

When using auto-versioning, Craft analyzes conventional commits to determine the version bump:

```yaml
name: Auto Release
on:
  schedule:
    - cron: '0 10 * * 1'  # Every Monday at 10 AM

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: getsentry/craft@v2
        with:
          version: auto
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Changelog Preview Action

The changelog preview action posts a comment on pull requests showing how they will appear in the changelog. This helps contributors understand the impact of their changes.

### Basic Usage

```yaml
name: Changelog Preview
on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  pull-requests: write

jobs:
  preview:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: getsentry/craft/changelog-preview@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### How It Works

1. **Generates the changelog** - Runs `craft changelog` to generate the upcoming changelog including all commits since the last tag
2. **Highlights PR entries** - Entries from the current PR are rendered with blockquote style (displayed with a left border in GitHub)
3. **Posts a comment** - Creates or updates a comment on the PR with the changelog preview
4. **Auto-updates** - The comment is automatically updated when new commits are pushed to the PR

### Example Comment

The action posts a comment like this:

```markdown
## 📋 Changelog Preview

This is how your changes will appear in the changelog.
Entries from this PR are highlighted with a left border (blockquote style).

---

### New Features ✨

> - feat(api): Add new endpoint by @you in #123

- feat(core): Existing feature by @other in #100

### Bug Fixes 🐛

- fix(ui): Resolve crash by @other in #99

---

🤖 This preview updates automatically when you push changes.
```

### Requirements

- The workflow needs `pull-requests: write` permission to post comments
- The repository should have a git history with tags for the changelog to be meaningful
- Use `fetch-depth: 0` in the checkout action to get full history

## Tips

### Combining Both Actions

You can use both actions together for a complete release workflow:

```yaml
# .github/workflows/changelog-preview.yml
name: Changelog Preview
on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  pull-requests: write

jobs:
  preview:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: getsentry/craft/changelog-preview@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

```yaml
# .github/workflows/release.yml
name: Release
on:
  workflow_dispatch:
    inputs:
      version:
        description: 'Version (leave empty for auto)'
        required: false

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: getsentry/craft@v2
        with:
          version: ${{ github.event.inputs.version || 'auto' }}
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Skipping Changelog Entries

Use `#skip-changelog` in your commit message or PR body to exclude a commit from the changelog:

```
chore: Update dependencies

#skip-changelog
```
