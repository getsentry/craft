---
title: "Getting Started"
description: "How to install and use Craft"
url: "https://craft.sentry.dev/pr-preview/pr-904/getting-started/"
---

# Getting Started

## Installation

### Binary

Craft provides [standalone executables](https://github.com/getsentry/craft/releases/latest) with Node embedded. Choose the file matching your operating system and CPU:

| Platform | Release file |
| --- | --- |
| macOS Apple Silicon | `craft-darwin-arm64.gz` |
| macOS Intel | `craft-darwin-x64.gz` |
| Linux arm64 | `craft-linux-arm64.gz` |
| Linux x64 | `craft-linux-x64.gz` |
| Windows x64 | `craft-win-x64.exe` |

Each release file has a matching `.sha256` checksum file. Native downloads are available starting with the first release containing these assets. Linux builds use glibc; Alpine/musl is not supported. macOS binaries are ad-hoc signed, without Developer ID notarization. Windows binaries do not have Authenticode signatures.

On macOS or Linux, download the archive and its checksum. In the download directory, verify with `shasum -a 256 -c craft-darwin-arm64.gz.sha256` on macOS or `sha256sum -c craft-linux-x64.gz.sha256` on Linux, substituting your filename. Only after verification succeeds, decompress with `gunzip <filename>.gz`, rename the executable to `craft`, run `chmod +x craft`, and move it to a directory on your PATH.

On Windows, download the `.exe` and checksum, then verify in PowerShell:

```powershell
$expected = ((Get-Content .\craft-win-x64.exe.sha256) -split '\s+')[0]
$actual = (Get-FileHash .\craft-win-x64.exe -Algorithm SHA256).Hash
if ($actual -ne $expected) { throw 'Craft checksum mismatch' }
.\craft-win-x64.exe --version
```


Rename it to `craft.exe` and put it in a directory on your PATH.

The existing release asset named `craft` remains a portable JavaScript bundle requiring Node. Existing action, CDN, and nightly consumers can continue using it.

### npm / pnpm

Install Craft as an [npm package](https://www.npmjs.com/package/@sentry/craft) when Node is already available. This uses the JavaScript bundle:

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

- [Docs home](https://craft.sentry.dev/pr-preview/pr-904/index.md)
- [Next: Configuration](https://craft.sentry.dev/pr-preview/pr-904/configuration.md)
