---
title: "Craft"
description: "Universal Release Tool (And More)"
url: "https://craft.sentry.dev/pr-preview/pr-934/"
---

# Craft

## Features

<CardGrid stagger>
  <Card title="Two-step releases" icon="rocket">
    `craft prepare` cuts a release branch with bumped versions and a changelog.
    `craft publish` ships the CI-built artifacts everywhere.
  </Card>
  <Card title="Automatic versioning" icon="star">
    Let Craft pick the next version from your conventional commits with
    `craft prepare auto`, or use semver bumps and CalVer.
  </Card>
  <Card title="Changelogs" icon="document">
    Generate changelogs from pull requests, preview them on every PR, and add
    optional AI summaries.
  </Card>
  <Card title="20+ targets" icon="list-format">
    Publish to GitHub, npm, PyPI, crates.io, NuGet, Docker, Maven, Homebrew,
    and many more from one configuration.
  </Card>
  <Card title="Monorepos" icon="seti:folder">
    Release independently versioned products from one repository with
    release workspaces.
  </Card>
  <Card title="GitHub Actions" icon="github">
    Drop-in reusable workflows for releases and changelog previews.
  </Card>
</CardGrid>

## Quick Example

```bash
# Auto-determine version from conventional commits
craft prepare auto

# Or specify a bump type
craft prepare minor

# Or use an explicit version
craft prepare 1.2.3

# Then publish to all configured targets
craft publish 1.2.3
```

## Explore the docs

<CardGrid>
  <LinkCard title="Quick Start" href="getting-started/" description="Set up a project and ship your first release." />
  <LinkCard title="Release Workflow" href="release-workflow/" description="What prepare and publish do, step by step." />
  <LinkCard title="Monorepos & Release Workspaces" href="workspaces/" description="Release several products from one repository." />
  <LinkCard title="Configuration Reference" href="configuration/" description="Every .craft.yml setting at a glance." />
</CardGrid>

## Pages in this section

- [Installation](https://craft.sentry.dev/pr-preview/pr-934/installation.md)
- [Quick Start](https://craft.sentry.dev/pr-preview/pr-934/getting-started.md)
- [Release Workflow](https://craft.sentry.dev/pr-preview/pr-934/release-workflow.md)
- [Versioning](https://craft.sentry.dev/pr-preview/pr-934/versioning.md)
- [Changelogs](https://craft.sentry.dev/pr-preview/pr-934/changelogs.md)
- [AI Changelog Summaries](https://craft.sentry.dev/pr-preview/pr-934/ai-summaries.md)
- [Monorepos & Release Workspaces](https://craft.sentry.dev/pr-preview/pr-934/workspaces.md)
- [GitHub Actions](https://craft.sentry.dev/pr-preview/pr-934/github-actions.md)
- [Configuration](https://craft.sentry.dev/pr-preview/pr-934/configuration.md)
- [CLI](https://craft.sentry.dev/pr-preview/pr-934/cli.md)
- [Contributing](https://craft.sentry.dev/pr-preview/pr-934/contributing.md)
- [Targets Overview](https://craft.sentry.dev/pr-preview/pr-934/targets.md)
