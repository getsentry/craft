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

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License

MIT
