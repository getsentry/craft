---
title: Getting Started
description: How to install and use Craft
---

## Installation

### Binary

Craft provides [standalone executables](https://github.com/getsentry/craft/releases/latest)
with Node embedded. Choose the file matching your operating system and CPU:

| Platform | Release file |
| --- | --- |
| macOS Apple Silicon | `craft-darwin-arm64.gz` |
| macOS Intel | `craft-darwin-x64.gz` |
| Linux arm64 | `craft-linux-arm64.gz` |
| Linux x64 | `craft-linux-x64.gz` |
| Windows x64 | `craft-win-x64.exe` |

Each release file has a matching `.sha256` checksum file. Native downloads are
available starting with the first release containing these assets. Linux builds
use glibc; Alpine/musl is not supported. macOS binaries are ad-hoc signed, without
Developer ID notarization. Windows binaries do not have Authenticode signatures.

On macOS or Linux, download the archive and its checksum. In the download
directory, verify with `shasum -a 256 -c craft-darwin-arm64.gz.sha256` on macOS
or `sha256sum -c craft-linux-x64.gz.sha256` on Linux, substituting your filename.
Only after verification succeeds, decompress with `gunzip <filename>.gz`, rename
the executable to `craft`, run `chmod +x craft`, and move it to a directory on
your PATH.

On Windows, download the `.exe` and checksum, then verify in PowerShell:

```powershell
$expected = ((Get-Content .\craft-win-x64.exe.sha256) -split '\s+')[0]
$actual = (Get-FileHash .\craft-win-x64.exe -Algorithm SHA256).Hash
if ($actual -ne $expected) { throw 'Craft checksum mismatch' }
.\craft-win-x64.exe --version
```

Rename it to `craft.exe` and put it in a directory on your PATH.

The existing release asset named `craft` remains a portable JavaScript bundle
requiring Node. Existing action, CDN, and nightly consumers can continue using it.

### Homebrew

After the first stable release containing standalone binaries and the formula:

```shell
brew install getsentry/tools/craft
```

The formula selects the native macOS/Linux x64 or arm64 archive and verifies its
SHA-256 checksum. Node is embedded; Git is a formula dependency. Other publishing
targets still require their own tools (for example, npm, Docker, or Python).
Craft's stable release pipeline updates the formula in `getsentry/homebrew-tools`
after uploading the release assets. Pre-release versions do not update Homebrew.
Publishing requires the release credential to have write access to that tap.

### Shell installer

After the first release with native binaries, install the latest stable release
on macOS/Linux, or Windows x64 using Git Bash:

```bash
curl -fsSL https://craft.sentry.dev/install | bash
```

To pin a version or choose a directory, download the script first:

```bash
curl -fsSL https://craft.sentry.dev/install -o craft-install
bash craft-install --version 2.35.0 --install-dir "$HOME/.local/bin"
```

The installer checks SHA-256 and the executable's version before installing.
It uses `CRAFT_INSTALL_DIR`, an absolute `XDG_BIN_HOME`, an existing user bin
folder on PATH, or `~/.local/bin`. Add the printed directory to PATH yourself.
It does not use sudo or modify shell profiles. `--dry-run` prints the selected
version and platform without creating installation files. `CRAFT_VERSION`
can also pin a release. Linux binaries require glibc.

### Updating a standalone installation

```bash
craft update                 # latest stable release
craft update --check         # metadata only, without downloading the binary
craft update 2.35.0           # a specific published version
craft update 2.35.0 --force   # reinstall or allow a downgrade
craft update --dry-run       # metadata only; no files changed
```

The updater validates the release assets, SHA-256, and candidate version before
replacing the running executable. macOS signatures are verified too. Unix uses
atomic replacement; Windows keeps a backup until replacement succeeds and
restores it if replacement fails. A running Windows process can prevent deletion
of the old backup; Craft prints its path so you can remove it after those
processes exit. A stale `.craft-install.lock` after a crash must be removed
only after checking that no installation/update is still running.

`craft update` is manual; it does not run background updates. npm/pnpm and
Homebrew installations receive instructions to use their package manager.
Explicit prerelease versions are allowed, while the default selects stable.

### Shell completion

`craft setup` installs completions for the shell detected from `$SHELL`.
Choose a shell explicitly with `craft setup --shell bash` (also `zsh` or `fish`).
This works with standalone, npm/pnpm, and Homebrew installations. The installer
runs setup automatically; `craft setup --no-completions` skips this step.

To print scripts without writing files:

```bash
craft completion bash
craft completion zsh
craft completion fish
```

Bash files live under `$XDG_DATA_HOME/bash-completion/completions`, defaulting to
`~/.local/share`; source the printed file if your shell does not load it automatically.
For zsh, add the printed `zsh/site-functions` directory to `fpath` before `compinit`.
Fish files live under `$XDG_CONFIG_HOME/fish/completions`, defaulting to `~/.config`.
Relative XDG paths are ignored. Both `craft` and `sentry-craft` aliases are supported.
Setup prints instructions and does not modify shell profiles. Dry-run writes no
completion files; custom files and symlink destinations are preserved.

### Agent skills

`craft setup` installs an embedded, version-pinned `craft-cli` skill into
`~/.agents/skills/craft-cli` and `~/.claude/skills/craft-cli` when those agent
roots already exist and are writable. No network download is needed. This works
with standalone and npm/pnpm/Homebrew installations.

```bash
craft setup --no-agent-skills # remember an opt-out from installation/refresh
craft setup --agent-skills    # re-enable installation/refresh
```

The preference is saved in `$XDG_CONFIG_HOME/craft/setup.json`, defaulting to
`~/.config/craft/setup.json`. Standalone updates refresh the skill using the new
binary and honor the saved opt-out. Package-manager users rerun `craft setup`
after upgrading. Opt-out preserves existing skill files; remove them manually
if you want agents to stop discovering the skill. Custom files and file symlinks
are preserved. Dry-run writes neither preferences nor skill files.

### npm / pnpm (not recommended)

Standalone executables are recommended. The [npm package](https://www.npmjs.com/package/@sentry/craft)
remains supported when Node is already available and uses the JavaScript bundle:

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

## Workflow

### `craft prepare`: Preparing a New Release

This command creates a new release branch, checks the changelog entries, runs a version-bumping script, and pushes this branch to GitHub. CI triggered by pushing this branch will build release artifacts and upload them to your artifact provider.

**Version Specification**

The `NEW-VERSION` argument can be specified in three ways (or omitted to use `auto`):

1. **Explicit version** (e.g., `1.2.3`): Release with the specified version
2. **Bump type** (`major`, `minor`, or `patch`): Automatically increment the latest tag
3. **Auto** (`auto` or omit the argument): Analyze commits since the last tag and determine bump type from conventional commit patterns

```shell
craft prepare [NEW-VERSION]

🚢 Prepare a new release branch

Positionals:
  NEW-VERSION  The new version to release. Can be: a semver string (e.g.,
               "1.2.3"), a bump type ("major", "minor", or "patch"), or "auto"
               to determine automatically from conventional commits. When
               omitted, defaults to "auto".                            [string]

Options:
  --no-input       Suppresses all user prompts                  [default: false]
  --dry-run        Dry run mode: no file writes, commits, pushes, or API mutations
  --rev, -r        Source revision (git SHA or tag) to prepare from
  --no-push        Do not push the release branch     [boolean] [default: false]
  --no-git-checks  Ignore local git changes and unsynchronized remotes
  --no-changelog   Do not check for changelog entries [boolean] [default: false]
  --publish        Run "publish" right after "release"[boolean] [default: false]
  --remote         The git remote to use when pushing [string] [default: "origin"]
  -v, --version    Show version number                                 [boolean]
  -h, --help       Show help                                           [boolean]
```

### `craft publish`: Publishing the Release

This command finds a release branch for the provided version, checks the build status, downloads release artifacts, and uploads them to configured targets.

```shell
craft publish NEW-VERSION

🛫 Publish artifacts

Positionals:
  NEW-VERSION  Version to publish                            [string] [required]

Options:
  --no-input         Suppresses all user prompts                [default: false]
  --dry-run          Dry run mode: no file writes, commits, pushes, or API mutations
  --target, -t       Publish to this target                     [default: "all"]
  --rev, -r          Source revision (git SHA or tag) to publish
  --no-merge         Do not merge the release branch after publishing
  --keep-branch      Do not remove release branch after merging it
  --keep-downloads   Keep all downloaded files        [boolean] [default: false]
  --no-status-check  Do not check for build status    [boolean] [default: false]
  -v, --version      Show version number                               [boolean]
  -h, --help         Show help                                         [boolean]
```

### `craft changelog`: Generate Changelog

Generate a changelog from git history without preparing a release. This is useful for previewing what would be included in a release or for CI integrations.

```shell
craft changelog

Generate changelog from git history

Options:
  --since, -s    Base revision (tag or SHA) to generate from. Defaults to latest tag.
  --pr           PR number for the current (unmerged) PR to include with highlighting.
  --format, -f   Output format: text (default) or json
```

Examples:

```shell
# Generate changelog since last tag
craft changelog

# Generate changelog since specific commit
craft changelog --since 2b58d3c

# Get detailed JSON output including bump type and commit stats
craft changelog --format json
```

:::note
This command requires `GITHUB_TOKEN` to fetch PR information from GitHub.
:::

### Example

Let's release version `1.2.3`:

```shell
# Prepare the release
$ craft prepare 1.2.3
```

This creates a release branch `release/1.2.3`, runs the version-bumping script, commits changes, and pushes to GitHub. CI builds artifacts and uploads them.

```shell
# Publish the release
$ craft publish 1.2.3
```

This finds the release branch, waits for CI to pass, downloads artifacts, and publishes to configured targets (e.g., GitHub and NPM).

## Version Naming Conventions

Craft supports [semantic versioning (semver)](https://semver.org)-like versions:

```txt
<major>.<minor>.<patch>(-<prerelease>)?(-<build>)?
```

- The `<major>`, `<minor>`, and `<patch>` numbers are required
- The `<prerelease>` and `<build>` identifiers are optional

### Preview Releases

Preview or pre-release identifiers **must** include one of:

```txt
preview|pre|rc|dev|alpha|beta|unstable|a|b
```

Examples:
- `1.0.0-preview`
- `1.0.0-alpha.0`
- `1.0.0-beta.1`
- `1.0.0-rc.20`

### Build Identifiers

Add a build identifier for platform-specific releases:

```txt
1.0.0+x86_64
1.0.0-rc.1+x86_64
```

## Global Configuration

Configure Craft using environment variables or configuration files.

All command line flags can be set through environment variables by prefixing them with `CRAFT_`:

```shell
CRAFT_LOG_LEVEL=Debug
CRAFT_DRY_RUN=1
CRAFT_NO_INPUT=0
```

### Dry-Run Mode

The `--dry-run` flag lets you preview what would happen without making real changes.

**How it works:**

Craft creates a temporary git worktree where all local operations run normally (branch creation, file modifications, commits). At the end, it shows a diff of what would change:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Dry-run complete. Here's what would change:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Files changed: 2
 M CHANGELOG.md
 M package.json

diff --git a/CHANGELOG.md b/CHANGELOG.md
...
```

**What's blocked:**
- Git push (nothing leaves your machine)
- GitHub API mutations (no releases, uploads, or changes)

**What's allowed:**
- All local operations (in a temporary worktree)
- Reading from GitHub API (requires `GITHUB_TOKEN`)

:::note
Dry-run still requires `GITHUB_TOKEN` for commands that fetch PR information from GitHub.
:::

### GitHub Token

Since Craft relies heavily on GitHub, set the `GITHUB_TOKEN` environment variable to a [GitHub Personal Access Token](https://github.com/settings/tokens) with `repo` scope.

### Environment Variables

Credentials and other configuration (`GITHUB_TOKEN`, `NPM_TOKEN`, etc.) must be provided directly via your shell or CI environment. Craft no longer reads `.craft.env` files — if one is found in your home directory or project directory, Craft will emit a warning at startup. Please migrate any values stored there to your shell or CI configuration.

## Caveats

- When interacting with remote GitHub repositories, Craft uses the remote `origin` by default. Set `CRAFT_REMOTE` or use the `--remote` option to change this.

## Integrating Your Project

1. **Set up a workflow** that builds assets and runs tests. Allow building release branches:

   ```yaml
   on:
     push:
       branches:
         - 'release/**'
   ```

2. **Upload artifacts** using `actions/upload-artifact@v2`:

   ```yaml
   - name: Archive Artifacts
     uses: actions/upload-artifact@v2
     with:
       name: ${{ github.sha }}
       path: |
         ${{ github.workspace }}/*.tgz
   ```

   Note: The artifact name must be `${{ github.sha }}`.

3. **Add `.craft.yml`** to your project with targets and options.

4. **Set up version bumping** (one of):
   - **Automatic** (recommended): Set `minVersion: "2.19.0"` and Craft will automatically bump versions based on your targets (npm, pypi, crates, etc.)
   - **Custom script**: Add `scripts/bump-version.sh` (or set `preReleaseCommand`)

5. **Configure environment variables** for your targets.

6. **Run** `craft prepare <version> --publish`!

Stable standalone upgrades use [binpatch](https://github.com/BYK/binpatch) delta
chains when available and smaller than the full download. Craft verifies the
patched executable against the target release digest before checking its version
and installing it. Missing, oversized, corrupt, or incompatible patches fall back
to the normal checksum-verified download. The first native release and explicit
prerelease installs use full downloads.
