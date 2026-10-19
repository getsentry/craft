---
title: "NuGet"
description: "Publish .NET packages to NuGet"
url: "https://craft.sentry.dev/pr-preview/pr-686/targets/nuget/"
---

# NuGet

Uploads packages to [NuGet](https://www.nuget.org/) via .NET Core.

## Configuration

| Option | Type | Description |
| --- | --- | --- |
| `workspaces` | `boolean` | Enable workspace discovery to auto-generate targets for all packages in the solution |
| `solutionPath` | `string` | Path to the solution file (`.slnx` or `.sln`) relative to repo root. Auto-discovers if not specified, preferring `.slnx` |
| `includeWorkspaces` | `string` | Regex pattern to filter which packages to include. Example: `'/^Sentry\\./'` |
| `excludeWorkspaces` | `string` | Regex pattern to filter which packages to exclude. Example: `'/\\.Tests$/'` |
| `serverUrl` | `string` | NuGet server URL. Default: `https://api.nuget.org/v3/index.json` |

## Workspace Support

When `workspaces: true` is enabled, Craft will automatically:

1. Parse the solution file (`.slnx` or `.sln`) to discover all projects, including projects nested in solution folders
2. Parse each `.csproj` file to extract package IDs and dependencies
3. Skip projects that are not packable (`<IsPackable>false</IsPackable>`)
4. Sort packages topologically so dependencies are published before dependents
5. Expand the single nuget target into multiple individual targets (one per package)
6. Publish packages sequentially in the correct order

Each package’s `.snupkg` symbol package, if present, is pushed together with its `.nupkg`.

This is useful for monorepos with multiple NuGet packages that depend on each other.

Note

Workspace discovery uses static file parsing only and does not execute any code from the target repository. This means MSBuild is not evaluated, so discovery follows these rules:

- `PackageId` and `IsPackable` are read from the `.csproj` and from the nearest `Directory.Build.props` (plus any `.props` files it imports with a static path, e.g. `<Import Project="..\Directory.Build.props" />`).
- Values with a `Condition`, or that reference other properties (`$(...)`), are ignored. `IsPackable` defaults to `true`.
- `<ProjectReference>` items count as dependencies regardless of conditions, including ones in statically imported `.props`/`.targets` files, so platform-specific dependencies are still published first.

Caution

Projects such as test apps or samples that don’t set `IsPackable` to `false` are treated as packages. Since no artifact is built for them, publishing them would fail. Exclude them with `excludeWorkspaces`.

The opposite mistake fails silently: a real package that discovery skips (because a filter is too strict or its `IsPackable` is conditional) is simply not published, and the release still succeeds. Run `craft targets` after changing the solution or the filters to check the expanded list.

If `workspaces: true` is set but discovery finds no packages, or the filters exclude all of them, Craft fails with a configuration error instead of skipping the target.

## Environment Variables

| Name | Description |
| --- | --- |
| `NUGET_API_TOKEN` | NuGet [API token](https://www.nuget.org/account/apikeys) |
| `NUGET_DOTNET_BIN` | Path to .NET Core. Default: `dotnet` |

## Examples

### Basic Usage

Publishes all `.nupkg` artifacts found:

```yaml
targets:
  - name: nuget
```


### Workspace Discovery

Automatically discovers and publishes all packages from a solution file in dependency order:

```yaml
targets:
  - name: nuget
    workspaces: true
```


### Workspace with Filtering

Publish only packages matching a pattern, excluding packable test apps:

```yaml
targets:
  - name: nuget
    workspaces: true
    solutionPath: Sentry.slnx
    includeWorkspaces: '/^Sentry/'
    excludeWorkspaces: '/(TrimTest|CrashableApp)$/'
```

## Navigation

- [Docs home](https://craft.sentry.dev/pr-preview/pr-686/index.md)
- [Parent: Targets Overview](https://craft.sentry.dev/pr-preview/pr-686/targets.md)
- [Previous: NPM](https://craft.sentry.dev/pr-preview/pr-686/targets/npm.md)
- [Next: PowerShell](https://craft.sentry.dev/pr-preview/pr-686/targets/powershell.md)
