<p align="center">
    <img src="https://sentry-brand.storage.googleapis.com/sentry-logo-black.png" width="280">
    <br />
</p>

# Craft: Universal Release Tool (And More)  <!-- omit in toc -->

[![Travis](https://img.shields.io/travis/getsentry/craft.svg)](https://travis-ci.org/getsentry/craft)
[![GitHub release](https://img.shields.io/github/release/getsentry/craft.svg)](https://github.com/getsentry/craft/releases/latest)
[![npm version](https://img.shields.io/npm/v/@sentry/craft.svg)](https://www.npmjs.com/package/@sentry/craft)
[![license](https://img.shields.io/github/license/getsentry/craft.svg)](https://github.com/getsentry/craft/blob/master/LICENSE)

`craft` is a command line tool that helps to automate and pipeline package releases. It suggests, and
then enforces a specific workflow for managing release branches, changelogs, artifact publishing, etc.

## Table of Contents  <!-- omit in toc -->

- [Installation](#installation)
- [Usage](#usage)
- [Caveats](#caveats)
- [Global Configuration](#global-configuration)
  - [`craft release`: Preparing a New Release](#craft-release-preparing-a-new-release)
  - [`craft publish`: Publishing the Release](#craft-publish-publishing-the-release)
  - [Example](#example)
- [Configuration File: `.craft.yml`](#configuration-file-craftyml)
  - [GitHub project](#github-project)
  - [Pre-release Command](#pre-release-command)
  - [Changelog Policies](#changelog-policies)
- [Target Configurations](#target-configurations)
  - [Per-target options](#per-target-options)
  - [GitHub (`github`)](#github-github)
  - [NPM (`npm`)](#npm-npm)
  - [Python Package Index (`pypi`)](#python-package-index-pypi)
  - [Homebrew (`brew`)](#homebrew-brew)
  - [NuGet (`nuget`)](#nuget-nuget)
  - [Rust Crates (`crates`)](#rust-crates-crates)
  - [Google Cloud Storage (`gcs`)](#google-cloud-storage-gcs)
  - [GitHub Pages (`gh-pages`)](#github-pages-gh-pages)
  - [Sentry Release Registry (`registry`)](#sentry-release-registry-registry)
- [Integrating Your Project with `craft`](#integrating-your-project-with-craft)
- [Pre-release (Version-bumping) Script: Conventions](#pre-release-version-bumping-script-conventions)
- [Development](#development)
  - [Logging level](#logging-level)
  - [Dry-run mode](#dry-run-mode)
  - [Releasing](#releasing)

## Installation

The tool is distributed as an NPM package and can be installed via `npm` or `yarn`:

```bash
npm install -g @sentry/craft

# Or

yarn global add @sentry/craft
```

## Usage

```
$ craft -h
craft <command>

Commands:
  dist publish <new-version>                      🛫  Publish artifacts             [aliases: p]
  dist release <major|minor|patch|new-version>    🚢  Prepare a new release branch  [aliases: r]

Options:
  -v, --version  Show version number                                                [boolean]
  -h, --help     Show help                                                          [boolean]
```

## Caveats

- When interacting with remote GitHub repositories, `craft` currently considers
  only one `git` remote: "origin"

## Global Configuration

`craft` requires a few environment variables to be present in order to function
properly.

* `GITHUB_API_TOKEN`

  Get your personal GitHub API token here: https://github.com/settings/tokens

  The token only needs "repo" scope.

* `ZEUS_API_TOKEN`

  You can generate your personal Zeus token here: https://zeus.ci/settings/token

  Required only for `craft publish`.

Additional environment variables can be required when publishing to specific
targets (e.g. `TWINE_USERNAME` and `TWINE_PASSWORD` for PyPI target).

### `craft release`: Preparing a New Release

This command will create a new release branch, check the changelog entries,
run a version-bumping script, and push the new branch to GitHub.

```
craft release <major|minor|patch|new-version>

🚢 Prepare a new release branch

Positionals:
  part, new-version  The version part (major, minor, patch) to increase, or the
                     version itself                                     [string]

Options:
  --no-push      Do not push the release branch       [boolean] [default: false]
  --publish      Run "publish" right after "release"  [boolean] [default: false]
```

### `craft publish`: Publishing the Release

The command will find a release branch for the provided version (tag) and
publish the existing artifacts from Zeus to configured targets.

```
craft publish <new-version>

🛫 Publish artifacts

Positionals:
  new-version  Version to publish                            [string] [required]

Options:
  --target, -t       Publish to this target
     [string] [choices: "brew", "github", "npm", "nuget", "pypi", "all", "none"]
                                                                [default: "all"]
  --rev, -r          Source revision to publish                         [string]
  --no-merge         Do not merge the release branch after publishing
                                                      [boolean] [default: false]
  --keep-branch      Do not remove release branch after merging it
                                                      [boolean] [default: false]
  --keep-downloads   Keep all downloaded files        [boolean] [default: false]
  --no-status-check  Do not check for build status in Zeus
                                                      [boolean] [default: false]
```

### Example

Let's imagine we want to release a new version of our package, and the version
in question is `1.2.3`.

We run `release` command first:

`$ craft release 1.2.3`

After some basic sanity checks this command creates a new release branch
`release/1.2.3`, runs the version-bumping script (`scripts/bump-version.sh`),
commits the changes made by the script, and then pushes the new branch to
GitHub. At this point CI systems kick in, and the results of those builds, as
well as built artifacts (binaries, NPM archives, Python wheels) are gradually
uploaded to Zeus.

To publish the built artifacts we run `publish`:

`$ craft publish 1.2.3`

This command will find our release branch (`release/1.2.3`), check the build
status of the respective git revision in Zeus, and then publish available
artifacts to configured targets (for example, to GitHub and NPM in the case of
Craft).

## Configuration File: `.craft.yml`

Project configuration for `craft` is stored in `.craft.yml` configuration file,
located in the project root.

### GitHub project

One of the required settings you need to specify is GitHub project parameters:

```yaml
github:
  owner: getsentry
  repo: craft
```

### Pre-release Command

This command will run on your newly created release branch as part of "release"
command. By default, it is set to "bash scripts/bump-version.sh". Please refer
to [this section](#pre-release-version-bumping-script-conventions) for more details.

```yaml
preReleaseCommand: bash scripts/bump-version.sh
```

### Changelog Policies

`craft` can help you to maintain change logs for your projects. At the moment,
`craft` supports only one approach (`"simple"`) to changelog management.
In this mode, `craft release` will remind you to add a changelog entry to the
changelog file (`CHANGELOG.md` by default).

**Configuration**

| Option            | Description                                                                       |
| ----------------- | --------------------------------------------------------------------------------- |
| `changelog`       | **optional**. Path to the changelog file. Defaults to `CHANGELOG.md`              |
| `changelogPolicy` | **optional**. Changelog management mode (`simple` or `none`). Defaults to `none`. |

**Example:**

```yaml
changelog: CHANGES
changelogPolicy: simple
```

**Valid changelog example:**

```text
## 1.3.5

* Removed something

## 1.3.4

* Added something
```

Additionally, `.craft.yml` is used for listing targets where you want to
publish your new release.

## Target Configurations

The configuration specifies which release targets to run for the repository. To
run more targets, list the target identifiers under the `targets` key in
`.craft.yml`.

**Example:**

```yaml
targets:
  - name: github
  - name: npm
```

### Per-target options

The following options can be applied to every target individually:

| Name           | Description                                                                                                                                                |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `includeNames` | **optional**. Regular expression: only matched files will be processed by the target.                                                                      |
| `excludeNames` | **optional**. Regular expression: the matched files will be skipped by the target. Matching is performed after testing for inclusion (via `includeNames`). |

**Example:**

```yaml
targets:
  - name: github
    includeNames: /^.*\.exe$/
    excludeNames: /^test.exe$/
```

### GitHub (`github`)

Create a release on Github. If a Markdown changelog is present in the
repository, this target tries to read the release name and description from the
changelog. Otherwise, defaults to the tag name and tag's commit message.

**Environment**

| Name               | Description                                                        |
| ------------------ | ------------------------------------------------------------------ |
| `GITHUB_API_TOKEN` | Personal GitHub API token (see https://github.com/settings/tokens) |

**Configuration**

| Option            | Description                                                                        |
| ----------------- | ---------------------------------------------------------------------------------- |
| `tagPrefix`       | **optional**. Prefix for new git tags (e.g. "v"). Empty by default.                |
| `previewReleases` | **optional**. Automatically detect and create preview releases. `true` by default. |

**Example:**

```yaml
targets:
  - name: github
    tagPrefix: v
    previewReleases: false
```

### NPM (`npm`)

Releases a NPM package to the public registry. This requires a package tarball
generated by `npm pack` in the artifacts. The file will be uploaded to the
registry with `npm publish`. This requires NPM to be authenticated with
sufficient permissions to publish the package.

**Environment**

The `npm` utility must be installed on the system.

| Name      | Description                                                 |
| --------- | ----------------------------------------------------------- |
| `NPM_BIN` | **optional**. Path to the npm executable. Defaults to `npm` |

**Configuration**

| Option   | Description                                                                      |
| -------- | -------------------------------------------------------------------------------- |
| `access` | **optional**. Visibility for scoped packages: `public` (default) or `restricted` |

**Example**

```yaml
targets:
  - name: npm
    access: restricted
```

### Python Package Index (`pypi`)

Uploads source dists and wheels to the Python Package Index via [twine](https://pypi.org/project/twine/).
The source code bundles and/or wheels must be in the release assets.

**Environment**

The `twine` Python package must be installed on the system.

| Name             | Description                                           |
| ---------------- | ----------------------------------------------------- |
| `TWINE_USERNAME` | User name for PyPI with access rights for the package |
| `TWINE_PASSWORD` | Password for the PyPI user                            |
| `TWINE_BIN`      | **optional**. Path to twine. Defaults to `twine`      |

**Configuration**

_none_

**Example**

```yaml
targets:
  - name: pypi
```

### Homebrew (`brew`)

Pushes a new or updated homebrew formula to a brew tap repository. The formula
is committed directly to the master branch of the tap on GitHub, therefore the
bot needs rights to commit to `master` on that repository. Therefore, formulas
on `homebrew/core` are not supported, yet.

The tap is configured with the mandatory `tap` parameter in the same format as
the `brew` utility. A tap `<org>/<name>` will expand to the GitHub repository
`github.com:<org>/homebrew-<name>`.

The formula contents are given as configuration value and can be interpolated
with Mustache template syntax (`{{ variable }}`). The interpolation context
contains the following variables:

* `version`: The new version
* `revision`: The tag's commit SHA
* `checksums`: A map containing sha256 checksums for every release asset. Use
  the full filename to access the sha, e.g. `checksums.MyProgram-x86`

**Environment**

| Name               | Description                                                        |
| ------------------ | ------------------------------------------------------------------ |
| `GITHUB_API_TOKEN` | Personal GitHub API token (seeh ttps://github.com/settings/tokens) |

**Configuration**

| Option     | Description                                                        |
| ---------- | ------------------------------------------------------------------ |
| `tap`      | The name of the homebrew tap used to access the GitHub repo        |
| `template` | The template for contents of the formula file (ruby code)          |
| `formula`  | **optional**. Name of the formula. Defaults to the repository name |
| `path`     | **optional**. Path to store the formula in. Defaults to `Formula`  |

**Example**

```yaml
targets:
  - name: brew
    tap: octocat/tools     # Expands to github.com:octocat/homebrew-tools
    formula: myproject     # Creates the file myproject.rb
    path: HomebrewFormula  # Creates the file in HomebrewFormula/
    template: >
      class MyProject < Formula
        desc "This is a test for homebrew formulae"
        homepage "https://github.com/octocat/my-project"
        url "https://github.com/octocat/my-project/releases/download/{{version}}/binary-darwin"
        version "{{version}}"
        sha256 "{{checksums.binary-darwin}}"

        def install
          mv "binary-darwin", "myproject"
          bin.install "myproject"
        end
      end
```

### NuGet (`nuget`)

Uploads packages to [NuGet](https://www.nuget.org/) via [.NET Core](https://github.com/dotnet/core).
By default, `craft` publishes all packages with `.nupkg` extension.

**Environment**

The `dotnet` tool must be available on the system.

| Name               | Description                                                      |
| ------------------ | ---------------------------------------------------------------- |
| `NUGET_API_TOKEN`  | NuGet personal API token (https://www.nuget.org/account/apikeys) |
| `NUGET_DOTNET_BIN` | **optional**. Path to .NET Core. Defaults to `dotnet`            |

**Configuration**

_none_

**Example**

```yaml
targets:
  - name: nuget
```

### Rust Crates (`crates`)

Publishes a single Rust package or entire workspace on the public crate registry
([crates.io](https://crates.io)). If the workspace contains multiple crates,
they are published in an order depending on their dependencies.

**Environment**

"cargo" must be installed and configured on the system.

| Name              | Description                                       |
| ----------------- | ------------------------------------------------- |
| `CRATES_IO_TOKEN` | The access token to the crates.io account         |
| `CARGO_BIN`       | **optional**. Path to cargo. Defaults to `cargo`. |

**Configuration**

_none_

**Example**

```yaml
targets:
  - name: crates
```

### Google Cloud Storage (`gcs`)

Uploads artifacts to a bucket in Google Cloud Storage.

The bucket paths (`paths`) can be interpolated using Mustache syntax (`{{ variable }}`). The interpolation context contains the following variables:

* `version`: The new project version
* `revision`: The SHA revision of the new version

**Environment**

| Name                         | Description                                                              |
| ---------------------------- | ------------------------------------------------------------------------ |
| `CRAFT_GCS_CREDENTIALS_PATH` | Local filesystem path to Google Cloud credentials (service account file) |

**Configuration**

| Option        | Description                                                |
| ------------- | ---------------------------------------------------------- |
| `bucket`      | The name of the GCS bucket where artifacts are uploaded    |
| `paths`       | A string or a list of strings that represent bucket paths. |
| `maxCacheAge` | Name of the formula. Defaults to the repository name       |

**Example**

```yaml
targets:
  - name: gcs
    bucket: bucket-name
    paths:
      - release/{{version}}/download
      - release/{{ref}}/platform/package
    maxCacheAge: 90
```

### GitHub Pages (`gh-pages`)

Extracts an archive with static assets and pushes them to the specified git
branch (`gh-pages` by default). Thus, it can be used to publish documentation
or any other assets to [GitHub Pages](https://pages.github.com/), so they will be later automatically rendered
by GitHub.

By default, this target will look for an artifact named `gh-pages.zip`, extract it,
and commit its contents to `gh-pages` branch.

_WARNING!_ The destination branch will be completely overwritten by the contents
of the archive.

**Environment**

_none_

**Configuration**

| Option        | Description                                                                             |
| ------------- | --------------------------------------------------------------------------------------- |
| `branch`      | **optional** The name of the branch to push the changes to. `gh-pages` by default.      |
| `githubOwner` | **optional** GitHub project owner, defaults to the value from the global configuration. |
| `githubRepo`  | **optional** GitHub project name, defaults to the value from the global configuration.  |


**Example**

```yaml
targets:
  - name: gh-pages
    branch: gh-pages

```

### Sentry Release Registry (`registry`)

The target will update the Sentry release registry repo(https://github.com/getsentry/sentry-release-registry/) with the latest version of the
project `craft` is used with. The release registry repository will be checked out
locally, and then the new version file will be created there, along with the necessary
symbolic links.

Two package types are supported: "sdk" and "app". Type "sdk" means that the package
is uploaded to one of the public registries (PyPI, NPM, Nuget, etc.), and that
the corresponding package directory can be found inside "packages" directory of the
release regsitry. Type "app" indicates that the package's version files are located
in "apps" directory of the registry.

**Environment**

_none_

**Configuration**

| Option             | Description                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------- |
| `type`             | Type of the package: can be "sdk" or "app".                                                                   |
| `config.canonical` | Canonical name of the package that includes package registry name (e.g. NPM, PyPI) and the full package name. |
| `urlTemplate`      | **optional** URL template that will be used to generate download links for "app" package type.                |
| `linkPrereleases`  | **optional** Update package versions even if the release is a preview release, "false" by default.            |


**Example**

```yaml
targets:
  - name: registry
    type: sdk
    config:
      canonical: "npm:@sentry/browser"

  - name: registry
    type: app
    urlTemplate: "https://example.com/{version}/{file}"
    config:
      canonical: "npm:@sentry/browser"
```

## Integrating Your Project with `craft`

Here is how you can integrate your GitHub project with `craft`:

* Enable your project in Zeus: https://zeus.ci/settings/github/repos
* Configure your CI systems (Travis, AppVeyor, etc.) to send build artifacts to Zeus
  * Allow building release branches (their names follow pattern `release/VERSION`)
  * Add ZEUS_HOOK_BASE as protected to CI environment
* Add `.craft.yml` configuration file to your project
  * List there all the targets you want to publish to
  * Configure additional options (changelog management policy, tag prefix, etc.)
* Add a [pre-release script](#pre-release-version-bumping-script-conventions) to your project.
* Get various [configuration tokens](#global-configuration)
* Start releasing!

## Pre-release (Version-bumping) Script: Conventions

Among other actions, `craft release` runs an external project-specific command
or script that is responsible for version bumping. By default, this script
should be located at the following path: `scripts/bump-version.sh` (relative
to the project root). The command can be configured by specifying
`preReleaseCommand` configuration option in `craft.yml`.

The following requirements are on the script interface and functionality:

* The script must accept at least two arguments. Craft will pass the following
  values as the last two arguments (in the specified order): the old ("from")
  version, and the second one is the new ("to") version.
* The script must replace all relevant occurrences of the old version string
  with the new one.
* The script must not commit the changes made.
* The script must not change the state of the git repository (e.g. changing branches)

**Example**

```bash
#!/bin/bash
### Example of a version-bumping script for an NPM project.
### Located at: scripts/bump-version.sh
set -eux
OLD_VERSION="${1}"
NEW_VERSION="${2}"

# Do not tag and commit changes made by "npm version"
export npm_config_git_tag_version=false
npm version "${NEW_VERSION}"
```

## Development

### Logging level

Logging level for `craft` can be configured via setting `CRAFT_LOG_LEVEL`
environment variable.

Accepted values are: `debug`, `success` (default), `info`, `warn`, `error`.

### Dry-run mode

Dry-run mode can be enabled via setting `DRY_RUN` environment variable to any
truthy value (any value other than `unset`, `""`, `0`, `false` and `no`).

In dry-run mode no destructive actions will be performed (creating branches,
pushing tags, committing files, etc.)

### Releasing

`craft` obviously uses `craft` for preparing and publishing new releases!
