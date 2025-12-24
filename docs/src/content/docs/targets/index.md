---
title: Targets Overview
description: Overview of all available release targets
---

Targets define where Craft publishes your release artifacts. Configure them in `.craft.yml` under the `targets` key.

## Available Targets

| Target | Description |
|--------|-------------|
| [GitHub](/craft/targets/github/) | Create GitHub releases and tags |
| [NPM](/craft/targets/npm/) | Publish to NPM registry |
| [PyPI](/craft/targets/pypi/) | Publish to Python Package Index |
| [Crates](/craft/targets/crates/) | Publish Rust crates |
| [NuGet](/craft/targets/nuget/) | Publish .NET packages |
| [Docker](/craft/targets/docker/) | Tag and push Docker images |
| [Homebrew](/craft/targets/brew/) | Update Homebrew formulas |
| [GCS](/craft/targets/gcs/) | Upload to Google Cloud Storage |
| [GitHub Pages](/craft/targets/gh-pages/) | Deploy static sites |
| [CocoaPods](/craft/targets/cocoapods/) | Publish iOS/macOS pods |
| [Ruby Gems](/craft/targets/gem/) | Publish Ruby gems |
| [Maven](/craft/targets/maven/) | Publish to Maven Central |
| [Hex](/craft/targets/hex/) | Publish Elixir packages |
| [pub.dev](/craft/targets/pub-dev/) | Publish Dart/Flutter packages |
| [AWS Lambda Layer](/craft/targets/aws-lambda-layer/) | Publish Lambda layers |
| [Registry](/craft/targets/registry/) | Update Sentry release registry |
| [UPM](/craft/targets/upm/) | Publish Unity packages |
| [Symbol Collector](/craft/targets/symbol-collector/) | Upload native symbols |
| [PowerShell](/craft/targets/powershell/) | Publish PowerShell modules |
| [Commit on Git Repository](/craft/targets/commit-on-git-repository/) | Push to a git repository |

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
