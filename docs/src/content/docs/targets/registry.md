---
title: Sentry Release Registry
description: Update Sentry's release registry
---

Updates the [Sentry release registry](https://github.com/getsentry/sentry-release-registry/) with the latest version.

:::tip
Avoid having multiple `registry` targets—it supports batching multiple apps and SDKs in a single target.
:::

## Configuration

| Option | Description                                                                  |
| ------ | ---------------------------------------------------------------------------- |
| `apps` | Dict of app configs keyed by canonical name (e.g., `app:craft`)              |
| `sdks` | Dict of SDK configs keyed by canonical name (e.g., `maven:io.sentry:sentry`) |

### App/SDK Options

| Option            | Description                                                                                                                                                                                                                                         |
|-------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `urlTemplate`     | URL template for artifact download links in the manifest. Supports `{{version}}`, `{{file}}`, and `{{revision}}` variables. Primarily for apps and CDN-hosted assets—not needed for SDK packages installed from public registries (npm, PyPI, etc.) |
| `linkPrereleases` | Update for preview releases. Default: `false`                                                                                                                                                                                                       |
| `checksums`       | List of checksum configs                                                                                                                                                                                                                            |
| `onlyIfPresent`   | Only run if matching file exists                                                                                                                                                                                                                    |
| `name`            | Human-readable name (used when creating new packages)                                                                                                                                                                                               |
| `sdkName`         | SDK identifier matching the SDK's `sdk_info.name` field in Sentry events (e.g., `sentry.javascript.react`). Will create the `sdks/` symlink. (used when creating new packages)                                                                      |
| `packageUrl`      | Link to package registry page, e.g., npmjs.com (used when creating new packages)                                                                                                                                                                    |
| `mainDocsUrl`     | Link to main documentation (used when creating new packages)                                                                                                                                                                                        |
| `apiDocsUrl`      | Link to API documentation (used when creating new packages)                                                                                                                                                                                         |

### Checksum Configuration

```yaml
checksums:
  - algorithm: sha256 # or sha384, sha512
    format: hex # or base64
```

## Example

```yaml
targets:
  - name: registry
    sdks:
      'npm:@sentry/browser':
    apps:
      'app:craft':
        urlTemplate: 'https://downloads.sentry-cdn.com/craft/{{version}}/{{file}}'
        checksums:
          - algorithm: sha256
            format: hex
```

## Package Types

- **sdk**: Package uploaded to public registries (PyPI, NPM, etc.)
- **app**: Standalone application with version files in the registry

## Creating New Packages

When you introduce a new package that doesn't yet exist in the release registry, Craft will automatically create the required directory structure and initial manifest on the first publish.

Supply `name`, `packageUrl`, `sdkName` and `mainDocsUrl` so the release registry entry is added to the registry for the first time (existing packages just need `onlyIfPresent` since the manifest already exists):

```yaml
targets:
  - name: registry
    sdks:
      'npm:@sentry/wasm':
        name: 'Sentry WASM'
        sdkName: 'sentry.javascript.wasm'
        packageUrl: 'https://www.npmjs.com/package/@sentry/wasm'
        mainDocsUrl: 'https://docs.sentry.io/platforms/javascript/'
```

## Manifest Metadata

### `repo_url`

The `repo_url` field is automatically set on every publish—it is not user-configurable per target. Craft resolves it in two ways:

1. **Auto-detection (default):** Craft reads the `origin` git remote URL and extracts the owner and repo. Both HTTPS (`https://github.com/org/repo.git`) and SSH (`git@github.com:org/repo.git`) formats are supported. For most repositories, no configuration is needed.

2. **Explicit config (rare):** If auto-detection isn't possible (e.g., the remote is not on `github.com`), you can provide it via a top-level `github` block in `.craft.yml`:
   ```yaml
   github:
     owner: getsentry
     repo: sentry-javascript
   ```

The value is always overwritten on every publish, so it stays in sync with the actual repository.

### Other metadata

When specified, the metadata fields (`name`, `sdkName`, `packageUrl`, `mainDocsUrl`, `apiDocsUrl`) are applied to every release, allowing you to update package metadata by changing your `.craft.yml` configuration.
