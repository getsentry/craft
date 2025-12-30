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
| `name` | Human-readable name (used when creating new packages) |
| `packageUrl` | Link to package registry page, e.g., npmjs.com (used when creating new packages) |
| `mainDocsUrl` | Link to main documentation (used when creating new packages) |
| `apiDocsUrl` | Link to API documentation (used when creating new packages) |

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

## Creating New Packages

When you introduce a new package that doesn't yet exist in the release registry, Craft will automatically create the required directory structure and initial manifest.

```yaml
targets:
  - name: registry
    sdks:
      'npm:@sentry/wasm':
        name: 'Sentry WASM'
        packageUrl: 'https://www.npmjs.com/package/@sentry/wasm'
        mainDocsUrl: 'https://docs.sentry.io/platforms/javascript/'
        urlTemplate: 'https://example.com/{{version}}/{{file}}'
```

## Manifest Metadata

The `repo_url` field is always derived from your GitHub repository configuration. When specified, the metadata fields (`name`, `packageUrl`, `mainDocsUrl`, `apiDocsUrl`) are applied to every release, allowing you to update package metadata by changing your `.craft.yml` configuration.
