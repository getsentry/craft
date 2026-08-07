---
title: "Getting Started"
description: "How to install and use Craft"
url: "https://craft.sentry.dev/pr-preview/pr-867/getting-started/"
---

# Getting Started

## Installation

### Binary

Craft is [distributed as a minified single JS binary](https://github.com/getsentry/craft/releases/latest). Download the latest release and add it to your PATH.

### npm (not recommended)

While the recommended approach is to use the binary directly, you can also install Craft as an [NPM package](https://www.npmjs.com/package/@sentry/craft):

```shell
pnpm add -g @sentry/craft
```


```shell
npm install -g @sentry/craft
```


## Usage

```shell
$ craft -h
craft <command>


Commands:
  craft prepare NEW-VERSION  🚢 Prepare a new release branch
                          [aliases: p, prerelease, prepublish, prepare, release]
  craft publish NEW-VERSION  🛫 Publish artifacts         [aliases: pp, publish]
  craft targets              List defined targets as JSON array
  craft config               Print the parsed, processed, and validated Craft
                             config for the current project in pretty-JSON.
  craft artifacts <command>  📦 Manage artifacts          [aliases: a, artifact]


Options:
  --no-input     Suppresses all user prompts                    [default: false]
  --dry-run      Dry run mode: no file writes, commits, pushes, or API mutations
  --log-level    Logging level
          [choices: "Fatal", "Error", "Warn", "Log", "Info", "Success", "Debug",
                                 "Trace", "Silent", "Verbose"] [default: "Info"]
  -v, --version  Show version number                                   [boolean]
  -h, --help     Show help                                             [boolean]
```

## Navigation

- [Docs home](https://craft.sentry.dev/pr-preview/pr-867/index.md)
- [Next: Configuration](https://craft.sentry.dev/pr-preview/pr-867/configuration.md)
