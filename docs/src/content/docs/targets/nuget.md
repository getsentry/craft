---
title: NuGet
description: Publish .NET packages to NuGet
---

Uploads packages to [NuGet](https://www.nuget.org/) via .NET Core.

## Configuration

| Option | Type | Description |
|--------|------|-------------|
| `workspaces` | `boolean` | Enable workspace discovery to auto-generate targets for all packages in the solution |
| `solutionPath` | `string` | Path to the solution file (`.sln`) relative to repo root. Auto-discovers if not specified |
| `includeWorkspaces` | `string` | Regex pattern to filter which packages to include. Example: `'/^Sentry\./'` |
| `excludeWorkspaces` | `string` | Regex pattern to filter which packages to exclude. Example: `'/\.Tests$/'` |
| `artifactTemplate` | `string` | Template for artifact filenames. Variables: `{{packageId}}`, `{{version}}` |
| `serverUrl` | `string` | NuGet server URL. Default: `https://api.nuget.org/v3/index.json` |

## Workspace Support

When `workspaces: true` is enabled, Craft will automatically:

1. Parse the solution file (`.sln`) to discover all projects
2. Parse each `.csproj` file to extract package IDs and dependencies
3. Sort packages topologically so dependencies are published before dependents
4. Expand the single nuget target into multiple individual targets (one per package)
5. Publish packages sequentially in the correct order

This is useful for monorepos with multiple NuGet packages that depend on each other.

:::note
Workspace discovery uses static file parsing only and does not execute any code from the target repository.
:::

## Environment Variables

| Name | Description |
|------|-------------|
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

Publish only packages matching a pattern, excluding test packages:

```yaml
targets:
  - name: nuget
    workspaces: true
    solutionPath: src/Sentry.sln
    includeWorkspaces: '/^Sentry\./'
    excludeWorkspaces: '/\.Tests$/'
```

### Custom Artifact Template

Use a custom artifact filename pattern:

```yaml
targets:
  - name: nuget
    workspaces: true
    artifactTemplate: 'packages/{{packageId}}.{{version}}.nupkg'
```
