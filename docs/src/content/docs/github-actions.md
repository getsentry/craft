---
title: GitHub Actions
description: Automate releases and changelog previews with Craft GitHub Actions
---

Craft provides GitHub Actions for automating releases and previewing changelog entries in pull requests.

For a real-world example of using Craft's GitHub Actions, see the [getsentry/publish](https://github.com/getsentry/publish) repository.

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

## Changelog Preview (Reusable Workflow)

The changelog preview workflow posts a comment on pull requests showing how they will appear in the changelog. This helps contributors understand the impact of their changes.

### Basic Usage

Call the reusable workflow from your repository:

```yaml
name: Changelog Preview
on:
  pull_request:
    types: [opened, synchronize, reopened, edited, labeled]

jobs:
  changelog-preview:
    uses: getsentry/craft/.github/workflows/changelog-preview.yml@v2
    secrets: inherit
```

### Inputs

| Input | Description | Default |
|-------|-------------|---------|
| `craft-version` | Version of Craft to use (tag or "latest") | `latest` |

### Pinning a Specific Version

```yaml
jobs:
  changelog-preview:
    uses: getsentry/craft/.github/workflows/changelog-preview.yml@v2
    with:
      craft-version: "2.15.0"
    secrets: inherit
```

### How It Works

1. **Generates the changelog** - Runs `craft changelog --pr <number>` to generate the upcoming changelog
2. **Fetches PR info** - Gets PR title, body, labels, and base branch from GitHub API
3. **Computes merge base** - Determines the merge base to exclude unmerged PR commits
4. **Highlights PR entries** - The current PR is rendered with blockquote style (displayed with a left border in GitHub)
5. **Posts a comment** - Creates or updates a comment on the PR with the changelog preview
6. **Auto-updates** - The comment is automatically updated when you update the PR (push commits, edit title/description, or change labels)

### Example Comment

The workflow posts a comment like this:

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

🤖 This preview updates automatically when you update the PR.
```

### PR Trigger Types

The workflow supports these PR event types:
- `opened` - When a PR is created
- `synchronize` - When new commits are pushed
- `reopened` - When a closed PR is reopened
- `edited` - When the PR title or description is changed
- `labeled` - When labels are added or removed

### Requirements

- Use `secrets: inherit` to pass the GitHub token
- The repository should have a git history with tags for the changelog to be meaningful

## Skipping Changelog Entries

### Using Magic Words

Use `#skip-changelog` in your commit message or PR body to exclude a commit from the changelog:

```
chore: Update dependencies

#skip-changelog
```

### Using Labels

You can configure labels to exclude PRs from the changelog. In your `.craft.yml`:

```yaml
changelog:
  categories:
    - title: "New Features ✨"
      labels: ["feature", "enhancement"]
    - title: "Bug Fixes 🐛"
      labels: ["bug", "fix"]
  exclude:
    labels: ["skip-changelog", "dependencies"]
    authors: ["dependabot[bot]", "renovate[bot]"]
```

PRs with the `skip-changelog` label or from excluded authors will not appear in the changelog.

## Tips

### Combining Both Actions

You can use both the changelog preview and release actions together for a complete release workflow. See the [getsentry/publish](https://github.com/getsentry/publish) repository for a real-world example.

```yaml
# .github/workflows/changelog-preview.yml
name: Changelog Preview
on:
  pull_request:
    types: [opened, synchronize, reopened, edited, labeled]

jobs:
  changelog-preview:
    uses: getsentry/craft/.github/workflows/changelog-preview.yml@v2
    secrets: inherit
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
