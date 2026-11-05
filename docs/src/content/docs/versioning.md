---
title: Versioning
description: How Craft picks the next version and updates it in your project files
---

Craft answers two questions on every release: *what is the next version?* and
*where does that version need to be written?*

## Version format

Craft supports [semantic versioning (semver)](https://semver.org)-like versions:

```txt
<major>.<minor>.<patch>(-<prerelease>)?(-<build>)?
```

- The `<major>`, `<minor>`, and `<patch>` numbers are required
- The `<prerelease>` and `<build>` identifiers are optional

### Preview releases

Preview or pre-release identifiers **must** include one of:

```txt
preview|pre|rc|dev|alpha|beta|unstable|a|b
```

Examples:

- `1.0.0-preview`
- `1.0.0-alpha.0`
- `1.0.0-beta.1`
- `1.0.0-rc.20`

The [GitHub target](../targets/github/#preview-releases) marks these as
pre-releases on GitHub.

### Build identifiers

Add a build identifier for platform-specific releases:

```txt
1.0.0+x86_64
1.0.0-rc.1+x86_64
```

## Choosing the next version

Pass the version to `craft prepare` in one of these forms:

| Argument | Result |
| --- | --- |
| `1.2.3` | Release exactly this version. |
| `major`, `minor`, `patch` | Increment the latest tag. |
| `auto` | Pick the bump from the commits since the latest stable tag, using the `semver` field of each [changelog category](../changelogs/#craft-extensions-to-releaseyml). |
| `pre` | Cut a prerelease of the version `auto` would release. |
| `calver` | Compute a [calendar version](#calendar-versioning-calver). |
| *(omitted)* | Use `versioning.policy`. |

Before the first tag, bump types and `auto` increment the version declared in
the release unit's project files instead, so `1.0.0-dev.0` becomes `1.0.0`.
Craft reads it from the files of the first configured target that
[supports version bumping](#supported-targets) and declares a semver version
above `0.0.0`. Without one, they increment `0.0.0`.

Before `1.0.0`, `auto` and `pre` treat breaking changes as a minor bump, so
`0.5.0` becomes `0.6.0`. Pass `1.0.0` or `major` to release `1.0.0`.

After a prerelease, bump types and `auto` promote it to a stable release:
`2.1.0-alpha.3` becomes `2.1.0`, or a higher version when the bump needs one.
To be safe, `auto` doesn't promote a prerelease to a major release: after
`2.0.0-alpha.3` it cuts `2.0.0-alpha.4`. Pass `2.0.0` or `major` to release
`2.0.0`.

`pre` takes the version `auto` would release and cuts a prerelease of it.
After `1.9.0`, it cuts `1.9.1-alpha.0` when `auto` picks a patch bump,
`1.10.0-alpha.0` for a minor bump, and `2.0.0-alpha.0` for a major bump. When
the latest tag is already a prerelease of that version, `pre` cuts the next one
instead: `1.10.0-alpha.1` after `1.10.0-alpha.0`.

Bump types, `auto`, and `calver` require `minVersion: '2.14.0'` or later, and
`pre` requires `minVersion: '3.9.0'` or later.

### Changelog base

The changelog of a release lists the changes since:

- **Stable release**: the latest stable tag, including the changes already in
  the prereleases since then. `2.0.0` lists the changes since `1.9.0`.
- **Prerelease**: the previous prerelease of the same `major.minor.patch`, or
  the latest stable tag when there is none. `2.0.0-alpha.4` lists the changes
  since `2.0.0-alpha.3`, and `2.1.0-alpha.0` lists the changes since `2.0.4`,
  not since `2.0.0-alpha.3`.

### Versioning policies

`versioning.policy` decides what happens when you omit the version:

```yaml
versioning:
  policy: auto # auto, manual, or calver
```

| Policy   | Behavior |
| -------- | -------- |
| `auto`   | Analyze commits to determine the bump. Default when `minVersion` is `2.14.0` or later. |
| `manual` | Require an explicit version argument. Default for older `minVersion` values. |
| `calver` | Use calendar-based versioning. |

To preview the bump Craft would choose, run `craft changelog --format json` or
add the [changelog preview workflow](../github-actions/#changelog-preview) to
your pull requests.

### Calendar versioning (CalVer)

For projects using calendar-based versions:

```yaml
versioning:
  policy: calver
  calver:
    format: '%y.%-m' # e.g., 24.12 for December 2024
    offset: 14 # Days to look back for date calculation
```

Format supports:

- `%y` - 2-digit year
- `%m` - Zero-padded month
- `%-m` - Month without padding

## Automatic version bumping

When `minVersion: "2.21.0"` or higher is set and no custom `preReleaseCommand` is defined, Craft automatically bumps version numbers based on your configured publish targets. This eliminates the need for a `scripts/bump-version.sh` script in most cases.

### How It Works

1. Craft examines your configured `targets` in `.craft.yml`
2. For each target that supports version bumping, Craft updates the appropriate project files
3. Targets are processed in the order they appear in your configuration
4. Each target type is only processed once (e.g., multiple npm targets won't bump `package.json` twice)

### Supported Targets

| Target    | Detection               | Version Bump Method                                         |
| --------- | ----------------------- | ----------------------------------------------------------- |
| `npm`     | `package.json` exists   | `npm version --no-git-tag-version` (with workspace support) |
| `pypi`    | `pyproject.toml` exists | hatch, poetry, setuptools-scm, or direct edit               |
| `crates`  | `Cargo.toml` exists     | `cargo set-version` (requires cargo-edit)                   |
| `gem`     | `*.gemspec` exists      | Direct edit of gemspec and `lib/**/version.rb`              |
| `pub-dev` | `pubspec.yaml` exists   | Direct edit of pubspec.yaml                                 |
| `hex`     | `mix.exs` exists        | Direct edit of mix.exs                                      |
| `nuget`   | `*.csproj` exists       | dotnet-setversion or direct XML edit                        |

### npm Workspace Support

For npm/yarn/pnpm monorepos, Craft automatically detects and bumps versions in all workspace packages:

- **npm 7+**: Uses `npm version --workspaces` to bump all packages at once
- **yarn/pnpm or npm < 7**: Falls back to bumping each non-private package individually

Workspace detection checks for:

- `workspaces` field in root `package.json` (npm/yarn)
- `pnpm-workspace.yaml` (pnpm)

Private packages (`"private": true`) are skipped during workspace version bumping.

### Python (pypi) Detection Priority

For Python projects, Craft detects the build tool and uses the appropriate method:

1. **Hatch** - If `[tool.hatch]` section exists → `hatch version <version>`
2. **Poetry** - If `[tool.poetry]` section exists → `poetry version <version>`
3. **setuptools-scm** - If `[tool.setuptools_scm]` section exists → No-op (version derived from git tags)
4. **Direct edit** - If `[project]` section with `version` field exists → Edit `pyproject.toml` directly

### Extra Version Files

A release unit often stores its version in more files than the manifests its
targets bump. List them under `versioning.files` and Craft writes the new
version into each one during the automatic bump:

```yaml
minVersion: '3.8.0'
versioning:
  files:
    # Updates the `version` field
    - path: packages/mcp-server/package.json
    # Writes 1.2.0 for a 1.2.0-dev.0 release
    - path: plugins/cli/.claude-plugin/plugin.json
      stripPrerelease: true
    # Updates `package.version`
    - path: crates/*/Cargo.toml
    # Updates the `version:` key in the YAML frontmatter
    - path: plugins/cli/skills/**/*.md
    # Anything else: replaces the capturing group of every match
    - path: src/sdk/_version.py
      format: regex
      pattern: '/__version__ = "([^"]+)"/'
```

Craft picks the format from the file name, so it can update every kind of
file its version-bumping targets update:

| `format` | Inferred for | Updates |
| --- | --- | --- |
| `json` | `*.json` | The string at `field`. Default: `version`. |
| `toml` | `*.toml` | The string at `field`. Default: `package.version` in `Cargo.toml`, `project.version` in `pyproject.toml`, otherwise `version`. |
| `yaml` | `*.yaml`, `*.yml` | The value at `field`. Default: `version`. |
| `frontmatter` | `*.md`, `*.mdx` | The value at `field` in the YAML frontmatter. Default: `version`. |
| `msbuild` | `*.csproj`, `*.fsproj`, `*.vbproj`, `*.props`, `*.targets` | `<Version>`, `<VersionPrefix>`, `<PackageVersion>`, `<AssemblyVersion>`, and `<FileVersion>`, like the `nuget` target. Clears `<VersionSuffix>` when there's a `<VersionPrefix>`. |
| `gem` | `*.gemspec`, `version.rb` | `spec.version = "…"` and `VERSION = "…"`, like the `gem` target. |
| `mix` | `mix.exs` | `version: "…"` and `@version "…"`, like the `hex` target. |
| `regex` | Never inferred | The capturing group of every match of `pattern`. |

Each entry accepts:

| Option | Description |
| --- | --- |
| `path` | File or glob, relative to the repository root. Paths can't contain `..`, and matches that resolve outside the repository are ignored. |
| `format` | One of the formats above. Required when Craft can't infer it from the path. |
| `field` | For `json`, `toml`, `yaml`, and `frontmatter`: the dotted key path to update, such as `expo.version` or `tool.poetry.version`. |
| `pattern` | For `regex` only: a `/source/flags` regular expression with exactly one capturing group, which Craft replaces with the version. |
| `stripPrerelease` | Write only `major.minor.patch`, without prerelease or build metadata. Default: `false`. |

Craft only changes the version value and leaves the rest of each file as it
is. In TOML and YAML files, it needs exactly one value at `field`, and it
skips TOML arrays of tables and YAML sequences and block scalars. `craft prepare`
fails before writing anything when a path matches no files, or when a matched
file has nothing to update.

`versioning.files` needs `minVersion: '3.8.0'` or higher and is part of
automatic version bumping, so it can't be combined with `preReleaseCommand`.
Craft rejects a configuration that sets both, including a workspace that
inherits one of them from the top level.

### Enabling Automatic Version Bumping

To enable automatic version bumping, ensure your `.craft.yml` has:

```yaml
minVersion: '2.21.0'
targets:
  - name: npm # or pypi, crates, etc.
  # ... other targets
```

And either:

- Remove any custom `preReleaseCommand`, or
- Don't define `preReleaseCommand` at all

### Disabling Automatic Version Bumping

To disable automatic version bumping while still using minVersion 2.21.0+:

```yaml
minVersion: '2.21.0'
preReleaseCommand: '' # Explicitly set to empty string
```

Or define a custom script:

```yaml
minVersion: '2.21.0'
preReleaseCommand: bash scripts/my-custom-bump.sh
```

### Error Handling

If automatic version bumping fails:

- **Missing tool**: Craft reports which tool is missing (e.g., "Cannot find 'npm' for version bumping")
- **Command failure**: Craft shows the error from the failed command
- **No supported targets**: Craft warns that no targets support automatic bumping
- **No applicable files**: If targets support bumping but none of them find a version to update (e.g. no `.csproj` with a `<Version>`), `craft prepare` fails instead of releasing with a stale version. Set `preReleaseCommand: ''` if your versions don't live in project files.

In all error cases, Craft suggests defining a custom `preReleaseCommand` as a fallback.

If a prepare fails after bumping versions, see
[Recovering from a failed prepare](../release-workflow/#recovering-from-a-failed-prepare).
