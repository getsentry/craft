<p align="center">
    <img src="img/logo.svg" width="280">
    <br />
</p>

# Craft: Universal Release Tool (And More) <!-- omit in toc -->

[![Travis](https://img.shields.io/travis/getsentry/craft.svg)](https://travis-ci.org/getsentry/craft)
[![GitHub release](https://img.shields.io/github/release/getsentry/craft.svg)](https://github.com/getsentry/craft/releases/latest)
[![npm version](https://img.shields.io/npm/v/@sentry/craft.svg)](https://www.npmjs.com/package/@sentry/craft)
[![license](https://img.shields.io/github/license/getsentry/craft.svg)](https://github.com/getsentry/craft/blob/master/LICENSE)

`craft` is a command line tool that helps to automate and pipeline package releases. It suggests, and
then enforces a specific workflow for managing release branches, changelogs, artifact publishing, etc.

## Table of Contents <!-- omit in toc -->

- [Installation](#installation)
- [Usage](#usage)
- [Caveats](#caveats)
- [Global Configuration](#global-configuration)
  - [Environment Files](#environment-files)
- [Workflow](#workflow)
  - [`craft prepare`: Preparing a New Release](#craft-prepare-preparing-a-new-release)
  - [`craft publish`: Publishing the Release](#craft-publish-publishing-the-release)
  - [Example](#example)
- [Configuration File: `.craft.yml`](#configuration-file-craftyml)
  - [GitHub project](#github-project)
  - [Pre-release Command](#pre-release-command)
  - [Post-release Command](#post-release-command)
  - [Release Branch Name](#release-branch-name)
  - [Changelog Policies](#changelog-policies)
  - [Minimal Version](#minimal-version)
  - [Required Files](#required-files)
- [Status Provider](#status-provider)
- [Artifact Provider](#artifact-provider)
  - [Using Github Actions with Github Artifact Provider](#using-github-actions-with-github-artifact-provider)
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
  - [Cocoapods (`cocoapods`)](#cocoapods-cocoapods)
  - [Docker (`docker`)](#docker-docker)
  - [Ruby Gems Index (`gem`)](#ruby-gems-index-gem)
  - [AWS Lambda Layer (`aws-lambda-layer`)](#aws-lambda-layer-aws-lambda-layer)
- [Integrating Your Project with `craft`](#integrating-your-project-with-craft)
- [Pre-release (Version-bumping) Script: Conventions](#pre-release-version-bumping-script-conventions)
- [Post-release Script: Conventions](#post-release-script-conventions)
- [Development](#development)
  - [Logging Level](#logging-level)
  - [Dry-run Mode](#dry-run-mode)
  - [Sentry Support](#sentry-support)
  - [Releasing](#releasing)

## Installation

The tool is distributed as an NPM package and can be installed via `npm` or `yarn`:

```bash
yarn global add @sentry/craft

# Or (not preferred):

npm install -g @sentry/craft
```

## Usage

```plain
$ craft -h
craft <command>

Commands:
  craft prepare NEW-VERSION  🚢 Prepare a new release branch
                          [aliases: p, prerelease, prepublish, prepare, release]
  craft publish NEW-VERSION  🛫 Publish artifacts           [aliases: pp, publish]

Options:
  --no-input     Suppresses all user prompts          [boolean] [default: false]
  --dry-run      Dry run mode: do not perform any real actions
                                                      [boolean] [default: false]
  -v, --version  Show version number                                   [boolean]
  -h, --help     Show help                                             [boolean]
```

## Caveats

- When interacting with remote GitHub repositories, `craft` uses by default the
  "origin" remote. If you have a different setup, set the `CRAFT_REMOTE`
  environment variable.

## Global Configuration

Global configuration for `craft` can be done either by using environment variables
or by adding values to a configuration file (see below).

In either case, at least the following two values must be configured in order
for craft to function properly:

- `GITHUB_TOKEN`

  Get your personal GitHub API token here: https://github.com/settings/tokens

  The token only needs "repo" scope ("repo:status" and "public_repo" subscopes, to be even more precise).

- `ZEUS_API_TOKEN`

  You can generate your personal Zeus token here: https://zeus.ci/settings/token

  Required only for `craft publish`.

Additional configuration may be required when publishing to specific
targets (e.g. `TWINE_USERNAME` and `TWINE_PASSWORD` for PyPI target).

### Environment Files

`craft` will read configuration variables (keys, tokens, etc.) from the
following locations:

- `$HOME/.craft.env`
- `$PROJECT_DIR/.craft.env`
- the shell's environment

...where `$HOME` is the current user's home directory, and `$PROJECT_DIR` is the directory where `.craft.yml` is located.

The above locations will be checked in the order specified above, with values
found in one location overwriting anything found in previous locations. In other
words, environment variables will take precedence over either configuration
file, and the project-specific file will take precedence over the file in
`$HOME`.

The files must be written in shell (`sh`/`bash`) format. Leading `export` is allowed.

Example:

```sh
# ~/.craft.env
GITHUB_TOKEN=token123
export NUGET_API_TOKEN=abcdefgh
```

## Workflow

### `craft prepare`: Preparing a New Release

This command will create a new release branch, check the changelog entries,
run a version-bumping script, and push the new branch to GitHub.

```plain
craft prepare NEW-VERSION

🚢 Prepare a new release branch

Positionals:
  NEW-VERSION  The new version you want to release           [string] [required]

Options:
  --no-input       Suppresses all user prompts        [boolean] [default: false]
  --dry-run        Dry run mode: do not perform any real actions
                                                      [boolean] [default: false]
  --no-push        Do not push the release branch     [boolean] [default: false]
  --no-git-checks  Ignore local git changes and unsynchronized remotes
                                                      [boolean] [default: false]
  --no-changelog   Do not check for changelog entries [boolean] [default: false]
  --publish        Run "publish" right after "release"[boolean] [default: false]
```

### `craft publish`: Publishing the Release

The command will find a release branch for the provided version (tag) and
publish the existing artifacts from the configured artifact provider to selected targets.

```plain
craft publish NEW-VERSION

🛫 Publish artifacts

Positionals:
  NEW-VERSION  Version to publish                            [string] [required]

Options:
  --no-input         Suppresses all user prompts      [boolean] [default: false]
  --dry-run          Dry run mode: do not perform any real actions
                                                      [boolean] [default: false]
  --target, -t       Publish to this target
  [string] [choices: "brew", "cocoapods", "crates", "gcs", "gh-pages", "github",
             "npm", "nuget", "pypi", "registry", "all", "none"] [default: "all"]
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

We run `prepare` command first:

`$ craft prepare 1.2.3`

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

One of the required settings you need to specify is GitHub project parameters. For example:

```yaml
github:
  owner: getsentry
  repo: sentry-javascript
```

### Pre-release Command

This command will run on your newly created release branch as part of `prepare`
command. By default, it is set to `bash scripts/bump-version.sh`. Please refer
to the [Pre-release version bumping script conventions section](#pre-release-version-bumping-script-conventions)
for more details.

```yaml
preReleaseCommand: bash scripts/bump-version.sh
```

### Post-release Command

This command will run after a successful `publish`. By default, it is set to
`bash scripts/post-release.sh`. It will _not_ error if the default script is
missing though, as this may not be needed by all projects. Please refer to the
[Post-release script conventions section](#post-release-script-conventions)
for more details.

```yaml
postReleaseCommand: bash scripts/post-release.sh
```

### Release Branch Name

This overrides the prefix for the release branch name. The full branch name used
for a release is `{releaseBranchPrefix}/{version}`. The prefix defaults to
`"release"`.

```yaml
releaseBranchPrefix: publish
```

### Changelog Policies

`craft` can help you to maintain change logs for your projects. At the moment,
`craft` supports two approaches: `simple`, and `auto` to changelog management.

In `simple` mode, `craft prepare` will remind you to add a changelog entry to the
changelog file (`CHANGELOG.md` by default).

In `auto` mode, `craft prepare` will use the following logic:

1. If there's already an entry for the given version, use that
2. Else if there is an entry named `Unreleased`, rename that to the given
   version
3. Else, create a new section for the version and populate it with a default
   text: `- No documented changes for this release.`

**Configuration**

| Option            | Description                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------ |
| `changelog`       | **optional**. Path to the changelog file. Defaults to `CHANGELOG.md`                       |
| `changelogPolicy` | **optional**. Changelog management mode (`none`, `simple`, or `auto`). Defaults to `none`. |

**Example (`simple`):**

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

**Example (`auto`):**

```yaml
changelog: CHANGES
changelogPolicy: auto
```

**Changelog with staged changes example:**

```text
## Unreleased

* Removed something

## 1.3.4

* Added something
```

Additionally, `.craft.yml` is used for listing targets where you want to
publish your new release.

### Minimal Version

It is possible to specify minimal `craft` version that is required to work with
your configuration.

**Example:**

```yaml
minVersion: '0.5.0'
```

### Required Files

You can provide a list of patterns for files that _have to be_ available before
proceeding with publishing. In other words, for every pattern in the given list
there has to be a file present that matches that pattern. This might be helpful
to ensure that we're not trying to do an incomplete release.

**Example:**

```yaml
requireNames:
  - /^sentry-craft.*\.tgz$/
  - /^gh-pages.zip$/
```

## Status Provider

You can configure which status providers `craft` will use to check for your build status.
By default, it will take Zeus but you can also use GitHub directly.
This is helpful if you don't want to rely on Zeus for asking if you build is green or not.

**Configuration**

| Option   | Description                                                                                        |
| -------- | -------------------------------------------------------------------------------------------------- |
| `name`   | Name of the status provider: either `zeus` (default) or `github`                                   |
| `config` | In case of `github`: may include `contexts` key that contains a list of required contexts (checks) |

**Example:**

```yaml
statusProvider:
  name: github
  config:
    contexts:
      - Travis CI - Branch
```

## Artifact Provider

You can configure which artifact providers `craft` will use to fetch artifacts from.
By default, Zeus is used, but in case you don't need use any artifacts in your
project, you can set it to `none`.

**Configuration**

| Option | Description                                                                |
| ------ | -------------------------------------------------------------------------- |
| `name` | Name of the artifact provider: can be `zeus` (default), `github` or `none` |

**Example:**

```yaml
artifactProvider:
  name: none
```

### Using Github Actions with Github Artifact Provider

When using Github Action you can use the Github Artifact Provider for managing your release artifacts.
The way it works is simple, use the official GHA `actions/upload-artifact@v2` action to upload your assets.
Craft can work with them and use it instead of Zeus.
Here is an example config (step) of an archive job:

```yaml
- name: Archive Artifacts
  uses: actions/upload-artifact@v2
  with:
    name: ${{ github.sha }}
    path: |
      ${{ github.workspace }}/*.tgz
      ${{ github.workspace }}/packages/tracing/build/**
      ${{ github.workspace }}/packages/**/*.tgz
```

A few important things to note:

- The name of the artifacts is very important and needs to be `name: ${{ github.sha }}`. Craft uses this as a unique id to fetch the artifacts.
- Keep in mind that this action maintains the folder structure and zips everything together. Craft will download the zip and recursively walk it to find all assets.

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

| Name           | Description                                                                                                                                                                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `includeNames` | **optional**. Regular expression: only matched files will be processed by the target. There is one special case that `includeNames` supports, if your build doesn't any artifacts you can write `includeNames: /none/`, this will skip the check for artifacts towards Zeus entirely. |
| `excludeNames` | **optional**. Regular expression: the matched files will be skipped by the target. Matching is performed after testing for inclusion (via `includeNames`).                                                                                                                            |

If neither option is included, all artifacts for the release will be processed by the target.

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

If `previewReleases` is set to `true` (which is the default), the release
created on GitHub will be marked as a pre-release version if the release name
contains any one of `preview`, `pre`, `rc`, `dev`,`alpha`, `beta`, `unstable`,
`a`, or `b`.

**Environment**

| Name           | Description                                                        |
| -------------- | ------------------------------------------------------------------ |
| `GITHUB_TOKEN` | Personal GitHub API token (see https://github.com/settings/tokens) |

**Configuration**

| Option            | Description                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------------- |
| `tagPrefix`       | **optional**. Prefix for new git tags (e.g. "v"). Empty by default.                          |
| `previewReleases` | **optional**. Automatically detect and create preview releases. `true` by default.           |
| `annotatedTag`    | **optional**. Creates an annotated tag, set to false for lightweight tag. `true` by default. |

**Example:**

```yaml
targets:
  - name: github
    tagPrefix: v
    previewReleases: false
    annotatedTag: false
```

### NPM (`npm`)

Releases an NPM package to the public registry. This requires a package tarball
generated by `npm pack` in the artifacts. The file will be uploaded to the
registry with `npm publish`, or with `yarn publish` if `npm` is not found. This
requires NPM to be authenticated with sufficient permissions to publish the package.

**Environment**

The `npm` utility must be installed on the system.

| Name                | Description                                                         |
| ------------------- | ------------------------------------------------------------------- |
| `NPM_TOKEN`         | An [automation token][npm-automation-token] allowed to publish.     |
| `NPM_BIN`           | **optional**. Path to the npm executable. Defaults to `npm`         |
| `YARN_BIN`          | **optional**. Path to the yarn executable. Defaults to `yarn`       |
| `CRAFT_NPM_USE_OTP` | **optional**. If set to "1", you will be asked for an OTP (for 2FA) |

[npm-automation-token]: https://docs.npmjs.com/creating-and-viewing-access-tokens

**Configuration**

| Option   | Description                                                                      |
| -------- | -------------------------------------------------------------------------------- |
| `access` | **optional**. Visibility for scoped packages: `restricted` (default) or `public` |

**Example**

```yaml
targets:
  - name: npm
    access: public
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

- `version`: The new version
- `revision`: The tag's commit SHA
- `checksums`: A map containing sha256 checksums for every release asset. Use
  the full filename to access the sha, e.g. `checksums.MyProgram-x86`

**Environment**

| Name           | Description                                                        |
| -------------- | ------------------------------------------------------------------ |
| `GITHUB_TOKEN` | Personal GitHub API token (seeh ttps://github.com/settings/tokens) |

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
    tap: octocat/tools # Expands to github.com:octocat/homebrew-tools
    formula: myproject # Creates the file myproject.rb
    path: HomebrewFormula # Creates the file in HomebrewFormula/
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

| Option      | Description                                                                                                                                                                                                                                          |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `noDevDeps` | **optional**. Strips `devDependencies` from crates before publishing. This is useful if a workspace crate uses circular dependencies for docs. Requires [`cargo-hack`](https://github.com/taiki-e/cargo-hack#readme) installed. Defaults to `false`. |

**Example**

```yaml
targets:
  - name: crates
    noDevDeps: false
```

### Google Cloud Storage (`gcs`)

Uploads artifacts to a bucket in Google Cloud Storage.

The bucket paths (`paths`) can be interpolated using Mustache syntax (`{{ variable }}`). The interpolation context contains the following variables:

- `version`: The new project version
- `revision`: The SHA revision of the new version

**Environment**

Google Cloud credentials can be provided using either of the following two environment variables.

| Name                          | Description                                                              |
| ----------------------------- | ------------------------------------------------------------------------ |
| `CRAFT_GCS_TARGET_CREDS_PATH` | Local filesystem path to Google Cloud credentials (service account file) |
| `CRAFT_GCS_TARGET_CREDS_JSON` | Full service account file contents, as a JSON string                     |

If defined, `CRAFT_GCS_TARGET_CREDS_JSON` will be preferred over `CRAFT_GCS_TARGET_CREDS_PATH`.

_Note:_ `CRAFT_GCS_TARGET_CREDS_JSON` and `CRAFT_GCS_TARGET_CREDS_PATH` were formerly called `CRAFT_GCS_CREDENTIALS_JSON` and `CRAFT_GCS_CREDENTIALS_PATH`, respectively. While those names will continue to work for the foreseeable future, you'll receive a warning encouraging you to switch to the new names.

**Configuration**

| Option           | Description                                                                                                                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bucket`         | The name of the GCS bucket where artifacts are uploaded.                                                                                                                                              |
| `paths`          | A list of path objects that represent bucket paths.                                                                                                                                                   |
| `paths.path`     | Template-aware bucket path, which can contain `{{ version }}` and/or `{{ revision }}`.                                                                                                                |
| `paths.metadata` | **optional** [Metadata](https://cloud.google.com/storage/docs/json_api/v1/objects/insert#request_properties_JSON) for uploaded files. By default, it sets `Cache-Control` to `"public, max-age=300"`. |

**Example**

```yaml
targets:
  - name: gcs
    bucket: bucket-name
    paths:
      - path: release/{{version}}/download
        metadata:
          cacheControl: `public, max-age=3600`
      - path: release/{{revision}}/platform/package
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

| Option             | Description                                                                                                                                                                                                                               |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`             | Type of the package: can be "sdk" or "app".                                                                                                                                                                                               |
| `config.canonical` | Canonical name of the package that includes package registry name (e.g. NPM, PyPI) and the full package name.                                                                                                                             |
| `urlTemplate`      | **optional** URL template that will be used to generate download links for "app" package type.                                                                                                                                            |
| `linkPrereleases`  | **optional** Update package versions even if the release is a preview release, "false" by default.                                                                                                                                        |
| `checksums`        | **optional** A list of checksums that will be computed for matched files (see `includeNames`). Every checksum entry is an object with two attributes: algorithm (one of "sha256", "sha384", and "sha512) and format ("base64" and "hex"). |
| `onlyIfPresent`    | **optional** A file pattern. The target will be executed _only_ when the matched file is found.                                                                                                                                           |

**Example**

```yaml
targets:
  - name: registry
    type: sdk
    config:
      canonical: 'npm:@sentry/browser'

  - name: registry
    type: app
    urlTemplate: 'https://example.com/{{version}}/{{file}}'
    config:
      canonical: 'npm:@sentry/browser'
    checksums:
      - algorithm: sha256
        format: hex
```

### Cocoapods (`cocoapods`)

Pushes a new podspec to the central cocoapods repository. The Podspec is fetched
from the Github repository with the revision that is being released. No release
assets are required for this target.

**Environment**

The `cocoapods` gem must be installed on the system.

| Name                    | Description                               |
| ----------------------- | ----------------------------------------- |
| `COCOAPODS_TRUNK_TOKEN` | The access token to the cocoapods account |
| `COCOAPODS_BIN`         | **optional**. Path to `pod` executable.   |

**Configuration**

| Option     | Description                                |
| ---------- | ------------------------------------------ |
| `specPath` | Path to the Podspec file in the repository |

**Example**

```yaml
targets:
  - name: cocoapods
    specPath: MyProject.podspec
```

### Docker (`docker`)

Pulls an existing source image tagged with the revision SHA, and then pushed it
to a new target tagged with the released version. No release
assets are required for this target except for the source image at the provided
source image location so it would be a good idea to add a status check that
ensures the source image exists, otherwise `craft publish` will fail at the
`docker pull` step, causing an interrupted publish. This is an issue for other,
non-idempotent targets, not for the Docker target.

**Environment**

`docker` executable (or something equivalent) must be installed on the system.

| Name              | Description                                |
| ----------------- | ------------------------------------------ |
| `DOCKER_USERNAME` | The username for the Docker registry.      |
| `DOCKER_PASSWORD` | The personal access token for the account. |
| `DOCKER_BIN`      | **optional**. Path to `docker` executable. |

**Configuration**

| Option         | Description                                                              |
| -------------- | ------------------------------------------------------------------------ |
| `source`       | Path to the source Docker image to be pulled                             |
| `sourceFormat` | Format for the source image name. Default: `{{{source}}}:{{{revision}}}` |
| `target`       | Path to the target Docker image to be pushed                             |
| `targetFormat` | Format for the target image name. Default: `{{{target}}}:{{{version}}}`  |

**Example**

```yaml
targets:
  - name: docker
    source: us.gcr.io/sentryio/craft
    target: getsentry/craft
# Optional but strongly recommended
statusProvider:
  name: github
  config:
    contexts:
      - Travis CI - Branch # or whatever builds and pushes your source image
```

### Ruby Gems Index (`gem`)

Pushes a gem [Ruby Gems](https://rubygems.org).
It also requires you to be logged in with `gem login`.

**Environment**

`gem` must be installed on the system.

| Name      | Description                                               |
| --------- | --------------------------------------------------------- |
| `GEM_BIN` | **optional**. Path to "gem" executable. Defaults to `gem` |

**Configuration**

_none_

**Example**

```yaml
targets:
  - name: gem
```

### AWS Lambda Layer (`aws-lambda-layer`)

The target will create a new public lambda layer in each available region with
the extracted artifact from the artifact provider, and update the Sentry release
registry with the new layer versions afterwards.

**Environment**

| Name                  | Description                                                                |
| --------------------- | -------------------------------------------------------------------------- |
| AWS_ACCESS_KEY        | The access key of the AWS account to create and publish the layers.        |
| AWS_SECRET_ACCESS_KEY | The secret access key of the AWS account to create and publish the layers. |

**Configuration**

| Option             | Description                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| includeNames       | **optional** Exists for all targets, [see here](##per-target-options). It must filter exactly one artifact.                                 |
| layerName          | The name of the layer to be published.                                                                                                      |
| compatibleRuntimes | A list of compatible runtimes for the layer. Each compatible runtime consists on the name of the runtime and a list of compatible versions. |
| license            | The license of the layer.                                                                                                                   |

**Example**

```yaml
targets:
  - name: aws-lambda-layer
    includeNames: /^sentry-node-serverless-\d+(\.\d+)*\.zip$/
    layerName: SentryNodeServerlessSDK
    compatibleRuntimes:
      - name: node
        versions:
          - nodejs10.x
          - nodejs12.x
    license: MIT
```

## Integrating Your Project with `craft`

Here is how you can integrate your GitHub project with `craft`:

- Enable your project in Zeus: https://zeus.ci/settings/github/repos
- Configure your CI systems (Travis, AppVeyor, etc.) to send build artifacts to Zeus
  - Allow building release branches (their names follow `release/{VERSION}` by
    default, configurable through `releaseBranchPrefix`)
  - Add ZEUS_HOOK_BASE as protected to CI environment
- Add `.craft.yml` configuration file to your project
  - List there all the targets you want to publish to
  - Configure additional options (changelog management policy, tag prefix, etc.)
- Add a [pre-release script](#pre-release-version-bumping-script-conventions) to your project.
- Get various [configuration tokens](#global-configuration)
- Start releasing!

## Pre-release (Version-bumping) Script: Conventions

Among other actions, `craft prepare` runs an external, project-specific command
or script that is responsible for version bumping. By default, this script
should be located at: `./scripts/bump-version.sh`. The command can be configured
by specifying the `preReleaseCommand` configuration option in `craft.yml`.

The following requirements are on the script interface and functionality:

- The script should accept at least two arguments. Craft will pass the old ("from")
  version and the new ("to") version as the last two arguments, respectively.
- The script must replace all relevant occurrences of the old version string
  with the new one.
- The script must not commit the changes made.
- The script must not change the state of the git repository (e.g. changing branches)

**Example**

```bash
#!/bin/bash
### Example of a version-bumping script for an NPM project.
### Located at: ./scripts/bump-version.sh
set -eux
OLD_VERSION="${1}"
NEW_VERSION="${2}"

# Do not tag and commit changes made by "npm version"
export npm_config_git_tag_version=false
npm version "${NEW_VERSION}"
```

## Post-release Script: Conventions

Among other actions, `craft publish` runs an external, project-specific command
or script that can do things like bumping the development version. By default,
this script should be located at: `./scripts/post-release.sh`. Unlike the
pre-release command, this script is not mandatory so if the file does not exist,
`craft` will report this fact and then move along as usual. This command can be
configured by specifying `postReleaseCommand` configuration option in `craft.yml`.

The following requirements are on the script interface and functionality:

- The script should accept at least two arguments. Craft will pass the old ("from")
  version and the new ("to") version as the last two arguments, respectively.
- The script is responsible for any and all `git` state management as `craft` will
  simply exit after running this script as the final step. This means the script
  is responsible for committing and pushing any changes that it may have made.

**Example**

```bash
#!/bin/bash
### Example of a dev-version-bumping script for a Python project
### Located at: ./scripts/post-release.sh
set -eux
OLD_VERSION="${1}"
NEW_VERSION="${2}"

# Ensure master branch
git checkout master
# Advance the CalVer release by one-month and add the `.dev0` suffix
./scripts/bump-version.sh '' $(date -d "$(echo $NEW_VERSION | sed -e 's/^\([0-9]\{2\}\)\.\([0-9]\{1,2\}\)\.[0-9]\+$/20\1-\2-1/') 1 month" +%y.%-m.0.dev0)
# Only commit if there are changes, make sure to `pull --rebase` before pushing to avoid conflicts
git diff --quiet || git commit -anm 'meta: Bump new development version' && git pull --rebase && git push
```

## Development

### Logging Level

Logging level for `craft` can be configured via setting `CRAFT_LOG_LEVEL`
environment variable.

Accepted values are: `debug`, `success` (default), `info`, `warn`, `error`.

### Dry-run Mode

Dry-run mode can be enabled via setting `DRY_RUN` environment variable to any
truthy value (any value other than `unset`, `""`, `0`, `false` and `no`).

In dry-run mode no destructive actions will be performed (creating branches,
pushing tags, committing files, etc.)

### Sentry Support

Errors you encounter while using Craft can be sent to Sentry. To use this feature,
add `CRAFT_SENTRY_DSN` variable to your environment (or "craft" configuration file) that
contains a Sentry project's DSN.

For example:

```bash
export CRAFT_SENTRY_DSN='https://1234@sentry.io/2345'
```

### Releasing

`craft` obviously uses `craft` for preparing and publishing new releases!
