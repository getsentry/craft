---
title: "NuGet"
description: "Publish .NET packages to NuGet"
url: "https://craft.sentry.dev/pr-preview/pr-901/targets/nuget/"
---

# NuGet

Uploads packages to [NuGet](https://www.nuget.org/) via .NET Core.

Note

This target allows re-entrant publishing to handle interrupted releases when publishing multiple packages.

## Configuration

| Option | Description |
| --- | --- |
| `serverUrl` | NuGet server URL. Default: `https://api.nuget.org/v3/index.json` |
| `timeout` | Timeout in seconds for each `dotnet nuget push` (passed as `--timeout`). Default: `1800` |

## Environment Variables

| Name | Description |
| --- | --- |
| `NUGET_API_TOKEN` | NuGet [API token](https://www.nuget.org/account/apikeys) |
| `NUGET_DOTNET_BIN` | Path to .NET Core. Default: `dotnet` |

## Example

```yaml
targets:
  - name: nuget
```


With a custom push timeout:

```yaml
targets:
  - name: nuget
    timeout: 3600
```

## Navigation

- [Docs home](https://craft.sentry.dev/pr-preview/pr-901/index.md)
- [Parent: Targets Overview](https://craft.sentry.dev/pr-preview/pr-901/targets.md)
- [Previous: NPM](https://craft.sentry.dev/pr-preview/pr-901/targets/npm.md)
- [Next: PowerShell](https://craft.sentry.dev/pr-preview/pr-901/targets/powershell.md)
