---
title: Targets Overview
description: Overview of all available release targets
---

Targets define where Craft publishes your release artifacts. Configure them in `.craft.yml` under the `targets` key.

## Available Targets

### Source control

| Target | Description |
|--------|-------------|
| [GitHub](./github/) | Create GitHub releases and tags |
| [Commit on Git Repository](./commit-on-git-repository/) | Push to a git repository |

### Package registries

| Target | Description |
|--------|-------------|
| [NPM](./npm/) | Publish to NPM registry |
| [PyPI](./pypi/) | Publish to Python Package Index |
| [Crates](./crates/) | Publish Rust crates |
| [NuGet](./nuget/) | Publish .NET packages |
| [Ruby Gems](./gem/) | Publish Ruby gems |
| [Maven](./maven/) | Publish to Maven Central |
| [Hex](./hex/) | Publish Elixir packages |
| [pub.dev](./pub-dev/) | Publish Dart/Flutter packages |
| [CocoaPods](./cocoapods/) | Publish iOS/macOS pods |
| [PowerShell](./powershell/) | Publish PowerShell modules |
| [UPM](./upm/) | Publish Unity packages |
| [Homebrew](./brew/) | Update Homebrew formulas |

### Containers, cloud, and hosting

| Target | Description |
|--------|-------------|
| [Docker](./docker/) | Tag and push Docker images |
| [AWS Lambda Layer](./aws-lambda-layer/) | Publish Lambda layers |
| [GCS](./gcs/) | Upload to Google Cloud Storage |
| [GitHub Pages](./gh-pages/) | Deploy static sites |
| [Cloudflare](./cloudflare/) | Deploy static sites or Workers to Cloudflare |
| [Vercel](./vercel/) | Deploy a prebuilt static site to Vercel |

### Sentry-specific

| Target | Description |
|--------|-------------|
| [Registry](./registry/) | Update Sentry release registry |
| [Symbol Collector](./symbol-collector/) | Upload native symbols |
| [Sentry PyPI](./pypi/#sentry-internal-pypi) (`sentry-pypi`) | Import a package into Sentry's internal PyPI |

## Basic Configuration

```yaml
targets:
  - name: npm
  - name: github
```

## Per-target Options

These options can be applied to any target:

| Option | Description |
|--------|-------------|
| `includeNames` | Regex pattern: only matched files are processed |
| `excludeNames` | Regex pattern: matched files are skipped |
| `id` | Unique ID to reference this target with `-t target[id]` |

Example:

```yaml
targets:
  - name: github
    includeNames: /^.*\.exe$/
    excludeNames: /^test.exe$/
  - name: registry
    id: browser
```

Targets run in the order they are listed.

## Running Specific Targets

Use the `-t` flag with `craft publish`:

```shell
# Publish to all targets
craft publish 1.2.3

# Publish to specific target
craft publish 1.2.3 -t npm

# Publish to target with ID
craft publish 1.2.3 -t registry[browser]

# Skip publishing (just merge branch)
craft publish 1.2.3 -t none
```
