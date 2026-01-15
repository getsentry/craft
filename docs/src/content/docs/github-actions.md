---
title: GitHub Actions
description: Automate releases and changelog previews with Craft GitHub Actions
---

Craft provides GitHub Actions for automating releases and previewing changelog entries in pull requests.

For a real-world example of using Craft's GitHub Actions, see the [getsentry/publish](https://github.com/getsentry/publish) repository.

## Prepare Release

Craft offers two ways to automate releases in GitHub Actions:

| Option                | Best For                           | Flexibility                        |
| --------------------- | ---------------------------------- | ---------------------------------- |
| **Reusable Workflow** | Quick setup, standard release flow | Low - runs as a complete job       |
| **Composite Action**  | Custom workflows, pre/post steps   | High - composable with other steps |

### Option 1: Reusable Workflow (Recommended)

The simplest way to set up Craft releases. Call the workflow and let it handle everything:

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
    uses: getsentry/craft/.github/workflows/release.yml@v2
    with:
      version: ${{ inputs.version }}
    secrets: inherit
```

#### Workflow Inputs

| Input                            | Description                                                                                                                             | Default                              |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `version`                        | Version to release. Can be a semver string (e.g., "1.2.3"), a bump type ("major", "minor", "patch"), or "auto" for automatic detection. | Uses `versioning.policy` from config |
| `merge_target`                   | Target branch to merge into.                                                                                                            | Default branch                       |
| `force`                          | Force a release even when there are release-blockers.                                                                                   | `false`                              |
| `blocker_label`                  | Label that blocks releases.                                                                                                             | `release-blocker`                    |
| `publish_repo`                   | Repository for publish issues (owner/repo format).                                                                                      | `{owner}/publish`                    |
| `git_user_name`                  | Git committer name.                                                                                                                     | GitHub actor                         |
| `git_user_email`                 | Git committer email.                                                                                                                    | Actor's noreply email                |
| `path`                           | The path that Craft will run inside.                                                                                                    | `.`                                  |
| `craft_config_from_merge_target` | Use the craft config from the merge target branch.                                                                                      | `false`                              |

#### Workflow Outputs

| Output         | Description                                  |
| -------------- | -------------------------------------------- |
| `version`      | The resolved version being released          |
| `branch`       | The release branch name                      |
| `sha`          | The commit SHA on the release branch         |
| `previous_tag` | The tag before this release (for diff links) |
| `changelog`    | The changelog for this release               |

### Option 2: Composite Action

Use the action directly when you need to add custom steps before or after the release, or integrate Craft into a more complex workflow:

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

      # Custom pre-release steps
      - run: echo "Running pre-release checks..."

      - uses: getsentry/craft@v2
        with:
          version: ${{ github.event.inputs.version }}
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      # Custom post-release steps
      - run: echo "Release prepared!"
```

The action accepts the same inputs and produces the same outputs as the reusable workflow.

### Auto-versioning Example

When using auto-versioning, Craft analyzes conventional commits to determine the version bump. This works with both the workflow and the action:

```yaml
# Using the reusable workflow
name: Auto Release
on:
  schedule:
    - cron: '0 10 * * 1' # Every Monday at 10 AM

jobs:
  release:
    uses: getsentry/craft/.github/workflows/release.yml@v2
    with:
      version: auto
    secrets: inherit
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

permissions:
  contents: read
  pull-requests: write

jobs:
  changelog-preview:
    uses: getsentry/craft/.github/workflows/changelog-preview.yml@v2
    secrets: inherit
```

### Inputs

| Input               | Description                                                                      | Default  |
| ------------------- | -------------------------------------------------------------------------------- | -------- |
| `working-directory` | Directory to run Craft in (relative to repo root)                                | `.`      |
| `craft-version`     | Version of Craft to use (tag or "latest")                                        | `latest` |
| `comment`           | Post changelog as PR comment (true) or as commit status with job summary (false) | `true`   |

### Output Modes

The workflow supports two output modes for displaying changelog previews:

#### Comment Mode (Default)

Posts the changelog preview as a PR comment that updates automatically:

```yaml
jobs:
  changelog-preview:
    uses: getsentry/craft/.github/workflows/changelog-preview.yml@v2
    with:
      comment: true # or omit for default
    secrets: inherit
```

**Pros:**

- Changelog visible directly on PR page
- All team members see updates immediately
- Familiar commenting interface

**Cons:**

- Creates notification noise on every update
- Multiple updates trigger multiple notifications
- Can clutter PR conversation on active branches

**Required permissions:**

```yaml
permissions:
  contents: read
  pull-requests: write
```

#### Status Check Mode

Creates a commit status with the semver impact and writes the full changelog to the Actions job summary:

```yaml
jobs:
  changelog-preview:
    uses: getsentry/craft/.github/workflows/changelog-preview.yml@v2
    with:
      comment: false
    secrets: inherit
```

**Pros:**

- Minimal notification noise
- Cleaner PR interface
- Semver impact visible in status checks section
- Full changelog available in Actions job summary
- Status appears independently (not grouped with other checks)

**Cons:**

- Requires clicking through to Actions run to see full changelog
- Less immediate visibility than comment

**Required permissions:**

```yaml
permissions:
  contents: read
  statuses: write
```

:::tip
Craft itself uses status check mode to avoid notification noise. You can see it in action on any PR in the [getsentry/craft repository](https://github.com/getsentry/craft/pulls).
:::

### Pinning a Specific Version

```yaml
permissions:
  contents: read
  pull-requests: write

jobs:
  changelog-preview:
    uses: getsentry/craft/.github/workflows/changelog-preview.yml@v2
    with:
      craft-version: '2.15.0'
    secrets: inherit
```

### How It Works

1. **Generates the changelog** - Runs `craft changelog --pr <number> --format json` to generate the upcoming changelog with metadata
2. **Fetches PR info** - Gets PR title, body, labels, and base branch from GitHub API
3. **Categorizes the PR** - Matches the PR to changelog categories based on labels and commit patterns
4. **Suggests version bump** - Based on matched categories with semver fields (major/minor/patch)
5. **Highlights PR entries** - The current PR is rendered with blockquote style (displayed with a left border in GitHub)
6. **Displays the preview** - Posts as a PR comment (default) or creates a neutral check run with job summary (when `comment: false`)
7. **Auto-updates** - The preview is automatically updated when you update the PR (push commits, edit title/description, or change labels)

:::note
The version bump suggestion requires categories in your `.github/release.yml` to have
`semver` fields defined. Without them, the suggested bump will show as "None".
See [Auto Mode configuration](/configuration/#auto-mode) for details.
:::

### Example Comment

The workflow posts a comment like this:

```markdown
## Suggested Version Bump

🟡 **Minor** (new features)

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

The workflow requires specific permissions and secrets to function correctly:

**Permissions** (required):

- `contents: read` - Allows the workflow to checkout your repository and read git history for changelog generation
- `pull-requests: write` - Required for comment mode (default) to post and update comments on pull requests
- `statuses: write` - Required for status check mode (when `comment: false`) to create commit statuses

**Secrets**:

- `secrets: inherit` - Passes your repository's `GITHUB_TOKEN` to the workflow, ensuring it has access to your repository (especially important for private repositories)

**Repository Setup**:

- The repository should have a git history with tags for the changelog to be meaningful

:::note[Why are these permissions needed?]
GitHub Actions reusable workflows use permission intersection - the final permissions are the intersection of what the caller grants and what the workflow declares. By explicitly declaring these permissions in your workflow file, you ensure the workflow can access your repository and perform the necessary actions, even for private repositories.

Note: You only need `pull-requests: write` for comment mode OR `statuses: write` for status check mode, not both. However, it's safe to grant both permissions if you're unsure which mode you'll use.
:::

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
    - title: 'New Features ✨'
      labels: ['feature', 'enhancement']
    - title: 'Bug Fixes 🐛'
      labels: ['bug', 'fix']
  exclude:
    labels: ['skip-changelog', 'dependencies']
    authors: ['dependabot[bot]', 'renovate[bot]']
```

PRs with the `skip-changelog` label or from excluded authors will not appear in the changelog.

## Tips

### Combining Both Workflows

You can use both the changelog preview and release workflows together for a complete release flow:

```yaml
# .github/workflows/changelog-preview.yml
name: Changelog Preview
on:
  pull_request:
    types: [opened, synchronize, reopened, edited, labeled]

permissions:
  contents: read
  pull-requests: write

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
    uses: getsentry/craft/.github/workflows/release.yml@v2
    with:
      version: ${{ inputs.version || 'auto' }}
    secrets: inherit
```
