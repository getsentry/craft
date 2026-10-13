---
title: NuGet
description: Publish .NET packages to NuGet
---

Uploads packages to [NuGet](https://www.nuget.org/) via .NET Core.

:::note
This target allows re-entrant publishing to handle interrupted releases when publishing multiple packages.
:::

## Configuration

No additional configuration options.

## Environment Variables

| Name | Description |
|------|-------------|
| `NUGET_API_TOKEN` | NuGet [API token](https://www.nuget.org/account/apikeys) |
| `NUGET_DOTNET_BIN` | Path to .NET Core. Default: `dotnet` |

## Example

```yaml
targets:
  - name: nuget
```
