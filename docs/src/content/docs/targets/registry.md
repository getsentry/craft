---
title: Sentry Release Registry
description: Update Sentry's release registry
---

Updates the [Sentry release registry](https://github.com/getsentry/sentry-release-registry/) with the latest version.

:::tip
Avoid having multiple `registry` targets—it supports batching multiple apps and SDKs in a single target.
:::

## Configuration

| Option | Description |
|--------|-------------|
| `apps` | Dict of app configs keyed by canonical name (e.g., `app:craft`) |
| `sdks` | Dict of SDK configs keyed by canonical name (e.g., `maven:io.sentry:sentry`) |

### App/SDK Options

| Option | Description |
|--------|-------------|
| `urlTemplate` | URL template for download links |
| `linkPrereleases` | Update for preview releases. Default: `false` |
| `checksums` | List of checksum configs |
| `onlyIfPresent` | Only run if matching file exists |

### Checksum Configuration

```yaml
checksums:
  - algorithm: sha256  # or sha384, sha512
    format: hex        # or base64
```

## Example

```yaml
targets:
  - name: registry
    sdks:
      'npm:@sentry/browser':
    apps:
      'app:craft':
        urlTemplate: 'https://example.com/{{version}}/{{file}}'
        checksums:
          - algorithm: sha256
            format: hex
```

## Package Types

- **sdk**: Package uploaded to public registries (PyPI, NPM, etc.)
- **app**: Standalone application with version files in the registry
