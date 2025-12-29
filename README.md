<p align="center">
    <img src="img/logo.svg" width="280">
    <br />
</p>

# Craft: Universal Release Tool <!-- omit in toc -->

[![GitHub release](https://img.shields.io/github/release/getsentry/craft.svg)](https://github.com/getsentry/craft/releases/latest)
[![npm version](https://img.shields.io/npm/v/@sentry/craft.svg)](https://www.npmjs.com/package/@sentry/craft)
[![license](https://img.shields.io/github/license/getsentry/craft.svg)](https://github.com/getsentry/craft/blob/master/LICENSE)

Craft is a command line tool that helps automate and pipeline package releases. It enforces a specific workflow for managing release branches, changelogs, and artifact publishing.

📚 **[Full Documentation](https://getsentry.github.io/craft/)**

## Quick Start

### Installation

Download the [latest binary release](https://github.com/getsentry/craft/releases/latest), or install via npm:

```shell
npm install -g @sentry/craft
```

### Usage

```shell
# Auto-determine version from conventional commits
craft prepare auto

# Or specify a version explicitly
craft prepare 1.2.3

# Publish to all configured targets
craft publish 1.2.3
```

## Features

- **Auto Versioning** - Automatically determine version bumps from conventional commits
- **Multiple Targets** - Publish to GitHub, NPM, PyPI, Docker, Crates.io, NuGet, and more
- **Changelog Management** - Auto-generate changelogs from commits or validate manual entries
- **Workspace Support** - Handle monorepos with NPM/Yarn workspaces
- **CI Integration** - Wait for CI to pass, download artifacts, and publish
- **GitHub Actions** - Built-in actions for release preparation and changelog previews
- **AI Summaries** - Optionally summarize verbose changelog sections using GitHub Models API

## AI-Powered Changelog Summaries

Craft can use [GitHub Models](https://github.com/marketplace/models) to summarize changelog sections with many entries into concise descriptions. Uses your existing GitHub token—no additional API keys required.

```yaml
aiSummaries:
  enabled: true
  kickInThreshold: 5  # Only summarize sections with >5 items
  model: "openai/gpt-4o-mini"  # optional, see available models below
```

### Authentication

The feature uses your GitHub token automatically:
- From `GITHUB_TOKEN` environment variable, or
- From `gh auth token` (GitHub CLI)

### Available Models

You can use any model from [GitHub Marketplace Models](https://github.com/marketplace/models):

```yaml
aiSummaries:
  model: "openai/gpt-4o-mini"        # Default, fast and capable
  model: "openai/gpt-4o"             # More capable, slower
  model: "meta/meta-llama-3.1-8b-instruct"  # Open source alternative
```

## Configuration

Create a `.craft.yml` in your project root:

```yaml
minVersion: "2.0.0"
changelog:
  policy: auto
targets:
  - name: github
  - name: npm
    access: public
```

See the [configuration reference](https://getsentry.github.io/craft/configuration/) for all options.

## Supported Targets

| Target | Description |
|--------|-------------|
| `github` | GitHub releases and tags |
| `npm` | NPM registry (with workspace support) |
| `pypi` | Python Package Index |
| `crates` | Rust crates.io |
| `nuget` | .NET NuGet |
| `docker` | Docker registries |
| `brew` | Homebrew formulas |
| `gcs` | Google Cloud Storage |
| `gh-pages` | GitHub Pages |
| `cocoapods` | CocoaPods |
| `gem` | RubyGems |
| `maven` | Maven Central |
| `hex` | Elixir Hex |
| `pub-dev` | Dart/Flutter pub.dev |
| `aws-lambda-layer` | AWS Lambda layers |
| `powershell` | PowerShell Gallery |

See the [targets documentation](https://getsentry.github.io/craft/targets/) for configuration details.

## GitHub Actions

Craft provides GitHub Actions for automating releases and previewing changelog entries.

### Prepare Release Action

Automates the `craft prepare` workflow in GitHub Actions:

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

**Inputs:**

| Input | Description | Default |
|-------|-------------|---------|
| `version` | Version to release (semver, "auto", "major", "minor", "patch") | Uses `versioning.policy` from config |
| `merge_target` | Target branch to merge into | Default branch |
| `force` | Force release even with blockers | `false` |
| `blocker_label` | Label that blocks releases | `release-blocker` |
| `publish_repo` | Repository for publish issues | `{owner}/publish` |

**Outputs:**

| Output | Description |
|--------|-------------|
| `version` | The resolved version being released |
| `branch` | The release branch name |
| `sha` | The commit SHA on the release branch |
| `changelog` | The changelog for this release |

### Changelog Preview (Reusable Workflow)

Posts a preview comment on PRs showing how they'll appear in the changelog:

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

The workflow will:
- Generate the upcoming changelog including the PR's changes
- Highlight entries from the PR using blockquote style (left border)
- Post a comment on the PR with the preview
- Automatically update when you update the PR (push, edit title/description, or change labels)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License

MIT
