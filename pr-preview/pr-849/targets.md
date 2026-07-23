---
title: "Targets Overview"
description: "Overview of all available release targets"
url: "https://craft.sentry.dev/pr-preview/pr-849/targets/"
---

# Targets Overview

Targets define where Craft publishes your release artifacts. Configure them in `.craft.yml` under the `targets` key.

## Available Targets

| Target | Description |
| --- | --- |
| [GitHub](https://craft.sentry.dev/pr-preview/pr-849/targets/github.md) | Create GitHub releases and tags |
| [NPM](https://craft.sentry.dev/pr-preview/pr-849/targets/npm.md) | Publish to NPM registry |
| [PyPI](https://craft.sentry.dev/pr-preview/pr-849/targets/pypi.md) | Publish to Python Package Index |
| [Crates](https://craft.sentry.dev/pr-preview/pr-849/targets/crates.md) | Publish Rust crates |
| [NuGet](https://craft.sentry.dev/pr-preview/pr-849/targets/nuget.md) | Publish .NET packages |
| [Docker](https://craft.sentry.dev/pr-preview/pr-849/targets/docker.md) | Tag and push Docker images |
| [Homebrew](https://craft.sentry.dev/pr-preview/pr-849/targets/brew.md) | Update Homebrew formulas |
| [GCS](https://craft.sentry.dev/pr-preview/pr-849/targets/gcs.md) | Upload to Google Cloud Storage |
| [GitHub Pages](https://craft.sentry.dev/pr-preview/pr-849/targets/gh-pages.md) | Deploy static sites |
| [Cloudflare](https://craft.sentry.dev/pr-preview/pr-849/targets/cloudflare.md) | Deploy static sites or Workers to Cloudflare |
| [CocoaPods](https://craft.sentry.dev/pr-preview/pr-849/targets/cocoapods.md) | Publish iOS/macOS pods |
| [Ruby Gems](https://craft.sentry.dev/pr-preview/pr-849/targets/gem.md) | Publish Ruby gems |
| [Maven](https://craft.sentry.dev/pr-preview/pr-849/targets/maven.md) | Publish to Maven Central |
| [Hex](https://craft.sentry.dev/pr-preview/pr-849/targets/hex.md) | Publish Elixir packages |
| [pub.dev](https://craft.sentry.dev/pr-preview/pr-849/targets/pub-dev.md) | Publish Dart/Flutter packages |
| [AWS Lambda Layer](https://craft.sentry.dev/pr-preview/pr-849/targets/aws-lambda-layer.md) | Publish Lambda layers |
| [Registry](https://craft.sentry.dev/pr-preview/pr-849/targets/registry.md) | Update Sentry release registry |
| [UPM](https://craft.sentry.dev/pr-preview/pr-849/targets/upm.md) | Publish Unity packages |
| [Symbol Collector](https://craft.sentry.dev/pr-preview/pr-849/targets/symbol-collector.md) | Upload native symbols |
| [PowerShell](https://craft.sentry.dev/pr-preview/pr-849/targets/powershell.md) | Publish PowerShell modules |
| [Commit on Git Repository](https://craft.sentry.dev/pr-preview/pr-849/targets/commit-on-git-repository.md) | Push to a git repository |

## Basic Configuration

```yaml
targets:
  - name: npm
  - name: github
```


## Per-target Options

These options can be applied to any target:

| Option | Description |
| --- | --- |
| `includeNames` | Regex pattern: only matched files are processed |
| `excludeNames` | Regex pattern: matched files are skipped |
| `id` | Unique ID to reference this target with `-t target[id]` |
| `onlyIfPresent` | Only run if a file matching this pattern exists |

Example:

```yaml
targets:
  - name: github
    includeNames: /^.*\.exe$/
    excludeNames: /^test.exe$/
  - name: registry
    id: browser
    onlyIfPresent: /^sentry-browser-.*\.tgz$/
```


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

## Navigation

- [Docs home](https://craft.sentry.dev/pr-preview/pr-849/index.md)
- [Previous: Contributing](https://craft.sentry.dev/pr-preview/pr-849/contributing.md)

## Pages in this section

- [AWS Lambda Layer](https://craft.sentry.dev/pr-preview/pr-849/targets/aws-lambda-layer.md)
- [Homebrew](https://craft.sentry.dev/pr-preview/pr-849/targets/brew.md)
- [Cloudflare](https://craft.sentry.dev/pr-preview/pr-849/targets/cloudflare.md)
- [CocoaPods](https://craft.sentry.dev/pr-preview/pr-849/targets/cocoapods.md)
- [Commit on Git Repository](https://craft.sentry.dev/pr-preview/pr-849/targets/commit-on-git-repository.md)
- [Crates](https://craft.sentry.dev/pr-preview/pr-849/targets/crates.md)
- [Docker](https://craft.sentry.dev/pr-preview/pr-849/targets/docker.md)
- [Google Cloud Storage](https://craft.sentry.dev/pr-preview/pr-849/targets/gcs.md)
- [Ruby Gems](https://craft.sentry.dev/pr-preview/pr-849/targets/gem.md)
- [GitHub Pages](https://craft.sentry.dev/pr-preview/pr-849/targets/gh-pages.md)
- [GitHub](https://craft.sentry.dev/pr-preview/pr-849/targets/github.md)
- [Hex](https://craft.sentry.dev/pr-preview/pr-849/targets/hex.md)
- [Maven](https://craft.sentry.dev/pr-preview/pr-849/targets/maven.md)
- [NPM](https://craft.sentry.dev/pr-preview/pr-849/targets/npm.md)
- [NuGet](https://craft.sentry.dev/pr-preview/pr-849/targets/nuget.md)
- [PowerShell](https://craft.sentry.dev/pr-preview/pr-849/targets/powershell.md)
- [pub.dev](https://craft.sentry.dev/pr-preview/pr-849/targets/pub-dev.md)
- [PyPI](https://craft.sentry.dev/pr-preview/pr-849/targets/pypi.md)
- [Sentry Release Registry](https://craft.sentry.dev/pr-preview/pr-849/targets/registry.md)
- [Symbol Collector](https://craft.sentry.dev/pr-preview/pr-849/targets/symbol-collector.md)
- [Unity Package Manager](https://craft.sentry.dev/pr-preview/pr-849/targets/upm.md)
