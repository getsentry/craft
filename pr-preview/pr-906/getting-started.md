---
title: "Getting Started"
description: "How to install and use Craft"
url: "https://craft.sentry.dev/pr-preview/pr-906/getting-started/"
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

Native downloads are available starting with the first release containing these assets. Linux builds use glibc; Alpine/musl is not supported. macOS binaries are ad-hoc signed, without Developer ID notarization. Windows binaries do not have Authenticode signatures.

Download the matching asset over HTTPS from the release page. On macOS or Linux, decompress with `gunzip <filename>.gz`, rename the executable to `craft`, run `chmod +x craft`, and move it to a directory on your PATH. On Windows, rename the downloaded executable to `craft.exe` and put it on your PATH. Run `craft --version` to check the installed version.

The existing release asset named `craft` remains a portable JavaScript bundle requiring Node. Existing action, CDN, and nightly consumers can continue using it.

### Homebrew

After the first stable release containing standalone binaries and the formula:

```shell
brew install getsentry/tools/craft
```


The formula selects the native macOS/Linux x64 or arm64 archive and verifies its SHA-256 checksum. Node is embedded; Git is a formula dependency. Other publishing targets still require their own tools (for example, npm, Docker, or Python). Craft’s stable release pipeline updates the formula in `getsentry/homebrew-tools` after uploading the release assets. Pre-release versions do not update Homebrew. Publishing requires the release credential to have write access to that tap.

### Shell installer

After the first release with native binaries, install the latest stable release on macOS/Linux, or Windows x64 using Git Bash:

```bash
curl -fsSL https://craft.sentry.dev/install | bash
```


To pin a version or choose a directory, download the script first:

```bash
curl -fsSL https://craft.sentry.dev/install -o craft-install
bash craft-install --version 2.35.0 --install-dir "$HOME/.local/bin"
```


The installer downloads over HTTPS and checks the executable’s version before installing. It uses `CRAFT_INSTALL_DIR`, an absolute `XDG_BIN_HOME`, an existing user bin folder on PATH, or `~/.local/bin`. Add the printed directory to PATH yourself. It does not use sudo or modify shell profiles. `--dry-run` prints the selected version and platform without creating installation files. `CRAFT_VERSION` can also pin a release. Linux binaries require glibc.

### Updating a standalone installation

```bash
craft update                 # latest stable release
craft update --check         # metadata only, without downloading the binary
craft update 2.35.0           # a specific published version
craft update 2.35.0 --force   # reinstall or allow a downgrade
craft update --dry-run       # metadata only; no files changed
```


The updater validates the HTTPS release assets and candidate version before replacing the running executable. macOS signatures are verified too. Unix uses atomic replacement; Windows keeps a backup until replacement succeeds and restores it if replacement fails. A running Windows process can prevent deletion of the old backup; Craft prints its path so you can remove it after those processes exit. A stale `.craft-install.lock` after a crash must be removed only after checking that no installation/update is still running.

`craft update` is manual; it does not run background updates. npm/pnpm and Homebrew installations receive instructions to use their package manager. Explicit prerelease versions are allowed, while the default selects stable.

### npm / pnpm (not recommended)

Standalone executables are recommended. The [npm package](https://www.npmjs.com/package/@sentry/craft) remains supported when Node is already available and uses the JavaScript bundle:

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

- [Docs home](https://craft.sentry.dev/pr-preview/pr-906/index.md)
- [Next: Configuration](https://craft.sentry.dev/pr-preview/pr-906/configuration.md)
