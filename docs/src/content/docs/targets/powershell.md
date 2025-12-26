---
title: PowerShell
description: Publish PowerShell modules to PowerShell Gallery
---

Uploads a module to [PowerShell Gallery](https://www.powershellgallery.com/) or another repository supported by PowerShellGet's `Publish-Module`.

The action looks for an artifact named `<module>.zip` and extracts it to a temporary directory for publishing.

## Configuration

| Option | Description |
|--------|-------------|
| `module` | Module name (required) |
| `repository` | Repository to publish to. Default: `PSGallery` |

## Environment Variables

| Name | Description |
|------|-------------|
| `POWERSHELL_API_KEY` | PowerShell Gallery API key (required) |
| `POWERSHELL_BIN` | Path to PowerShell binary. Default: `pwsh` |

## Example

```yaml
targets:
  - name: powershell
    module: Sentry
```

## Notes

- `pwsh` must be [installed](https://github.com/powershell/powershell#get-powershell) on the system
