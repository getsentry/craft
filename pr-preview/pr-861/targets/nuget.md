---
title: "NuGet"
description: "Publish .NET packages to NuGet"
url: "https://craft.sentry.dev/pr-preview/pr-861/targets/nuget/"
---

# NuGet

Uploads packages to [NuGet](https://www.nuget.org/) via .NET Core.

Note

This target allows re-entrant publishing to handle interrupted releases when publishing multiple packages.

## Configuration

No additional configuration options.

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

## Navigation

- [Docs home](https://craft.sentry.dev/pr-preview/pr-861/index.md)
- [Parent: Targets Overview](https://craft.sentry.dev/pr-preview/pr-861/targets.md)
- [Previous: NPM](https://craft.sentry.dev/pr-preview/pr-861/targets/npm.md)
- [Next: PowerShell](https://craft.sentry.dev/pr-preview/pr-861/targets/powershell.md)
