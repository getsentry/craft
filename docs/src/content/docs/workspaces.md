---
title: Monorepos & Release Workspaces
description: Release several independently versioned products from one repository
---

A **release workspace** is an independently versioned release unit inside one
repository. Each workspace gets its own versions, tags, release branches,
changelog, and targets, while sharing one `.craft.yml`.

Use release workspaces when one repository ships products on separate release
cycles, such as a CLI at `1.4.0` and an MCP server at `0.3.0`.

:::note[Release workspaces vs. package workspaces]
Release workspaces are unrelated to npm, pnpm, Yarn, or .NET *package*
workspaces.

- **Package workspaces** (`workspaces: true` on the [npm](../targets/npm/#workspaces-support)
  or [NuGet](../targets/nuget/#workspace-support) target) publish many packages
  together at **one shared version** in a single release.
- **Release workspaces** (top-level `workspaces:` in `.craft.yml`) give each
  unit **its own version and release**.

You can combine them: a release workspace can contain an npm target with
`workspaces: true`.
:::

## Define workspaces

Add a top-level `workspaces` map. Each key is a directory path relative to
`.craft.yml`; each value is a release unit configuration. Release workspaces
require `minVersion: 2.29.0` or later.

```yaml
minVersion: 2.29.0
github:
  owner: getsentry
  repo: toolkit
changelog:
  policy: auto
workspaces:
  packages/cli:
    releaseBranchPrefix: release/cli
    targets:
      - name: github
        tagPrefix: 'cli@'
      - name: npm
  tools/mcp:
    releaseBranchPrefix: release/mcp
    targets:
      - name: github
        tagPrefix: 'mcp@'
```

Releasing `1.2.3` for each workspace produces the tags `cli@1.2.3` and
`mcp@1.2.3` on the branches `release/cli/1.2.3` and `release/mcp/1.2.3`, so
the two products never collide.

### Inheritance

Top-level settings are defaults for every workspace. A workspace overrides a
setting by declaring it:

- These fields can be set per workspace: `targets`, `changelog`,
  `versioning`, `releaseBranchPrefix`, `preReleaseCommand`,
  `postReleaseCommand`, `requireNames`, `statusProvider`, `artifactProvider`,
  `noMerge`, and `github`.
- A declared field **replaces** the inherited value. For example, a
  workspace's `targets` list replaces the top-level list, and a workspace
  `changelog` object replaces the top-level object.
- `github` is the exception: it is merged, so a workspace can override just
  `owner` or `repo`.

Run `craft config --workspace <path>` to print the fully resolved
configuration for one workspace.

### Paths and patterns

Keys may be literal paths or glob patterns. Craft expands patterns to the
concrete directories that exist relative to `.craft.yml`, and ignores files
matched by a glob.

```yaml
workspaces:
  plugins/*:
    targets:
      - name: npm
```

:::caution
Every directory matched by a pattern gets the **same** settings, including the
same `tagPrefix` and `releaseBranchPrefix`. Give each product a literal key
when it needs its own tags and release branches.
:::

Workspace paths use nonempty ASCII path segments containing letters, digits,
periods, underscores, and hyphens. Segments cannot be `.`, `..`, `__proto__`,
or start with `-`. Craft rejects overlapping workspace keys, so each concrete
path belongs to exactly one key.

A configuration with `workspaces` cannot use `github.projectPath`.

## Select a workspace

Once `workspaces` is defined, every release command needs to know which
workspace to act on. Pass `--workspace <path>` or set `CRAFT_WORKSPACE`:

```shell
craft prepare auto --workspace packages/cli
craft publish 1.2.3 --workspace packages/cli

CRAFT_WORKSPACE=tools/mcp craft changelog
```

Craft fails with the list of available workspaces when none is selected. Use a
concrete path, not a glob pattern.

`craft workspace list` prints every concrete workspace path as a JSON array,
which is handy for CI matrices:

```shell
$ craft workspace list
[
    "packages/cli",
    "tools/mcp"
]
```

## Tags and version history

Give each workspace's `github` target its own `tagPrefix`. Craft scopes every
tag lookup (latest tag, changelog base, CalVer scans) to that prefix, so
products never pick up each other's version history. See
[GitHub target → Tag Prefixes](../targets/github/#tag-prefixes).

Inside a workspace, GitHub release titles also carry the tag prefix (for
example `cli@0.2.0`), so releases of different products stay distinguishable.
See [GitHub target → Release Workspaces](../targets/github/#release-workspaces).

:::caution
Declaring **multiple** `github` targets with **different** `tagPrefix` values in
one release unit is ambiguous: Craft uses the first prefix for read-path
operations and logs a warning. Split them into separate workspaces instead.
:::

## Workspace-aware changelogs

When a workspace is selected, its changelog file defaults to
`<workspace>/CHANGELOG.md` (when the workspace is a directory). Set
`changelog.filePath` to override it.

[Automatic changelogs](../changelogs/#auto-mode) include commits that change
files in the selected workspace and commits that change shared files outside
all workspaces. Commits confined to another workspace are excluded. Craft
detects package ownership from pnpm, npm, or Yarn workspaces as well as the
release workspaces in `.craft.yml`. Commits spanning workspaces appear in each
affected workspace's changelog. This also scopes
[automatic version detection](../versioning/#choosing-the-next-version).

If a release includes files from another workspace, add its directory to
`includePaths` on that release unit. Paths are relative to the repository root,
match whole directory names, and cannot escape the repository:

```yaml
workspaces:
  packages/cli:
    changelog:
      policy: auto
      includePaths:
        - apps/cli-docs
```

Most workspaces need no `includePaths` setting. Craft rejects `includePaths` and
`unownedPaths` in configurations without `workspaces`, because there is no
workspace ownership to adjust.

Files outside every workspace, such as root build files or an application that
lives at the repository root, count as shared by default. Use
`changelog.unownedPaths` to change that:

- `include` (default): shared files appear in this workspace's changelog.
- `exclude`: this workspace ignores shared files.
- `own`: this workspace owns them, and every other workspace ignores them. At
  most one workspace can use `own`.

For example, when the main application lives at the repository root next to
independently released packages:

```yaml
workspaces:
  app:
    changelog:
      policy: auto
      unownedPaths: own
  packages/ui:
    changelog:
      policy: auto
```

`app` gets commits to root files, and `packages/ui` gets only commits that touch
`packages/ui`.

A workspace's first release has no previous tag. Craft then starts its
changelog at the commit that added the workspace to `.craft.yml` instead of the
start of the repository history. Push a tag with the workspace's tag prefix to
start from a different commit.

## GitHub Actions

The [Craft Action and reusable release workflow](../github-actions/) accept a
`workspace` input:

```yaml
jobs:
  release:
    permissions:
      contents: write
    uses: getsentry/craft/.github/workflows/release.yml@v2
    with:
      version: auto
      workspace: packages/cli
    secrets: inherit
```

Publish request titles include the full workspace path, for example
`publish: getsentry/toolkit/packages/cli@1.2.3`. A workflow cannot set both
`path` and `workspace`.

## Known limitations

- GitHub tracks a single "Latest" release per repository, so the badge can move
  between products. See the
  [GitHub target](../targets/github/#the-latest-badge-in-monorepos).
- The [changelog preview workflow](../github-actions/#changelog-preview) has no
  `workspace` input yet.

## Alternative: one config per product

Before release workspaces, monorepos used one `.craft.yml` per product, each
with its own `github` target `tagPrefix` and a matching `releaseBranchPrefix`,
and ran Craft from that product's directory (the `path` input in GitHub
Actions). This still works, but release workspaces keep everything in one file
and add workspace-aware changelogs.
