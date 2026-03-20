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

### Per-package options

| Option            | Description                                                                                                                                                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `urlTemplate`     | URL template for artifact download links in the manifest. Supports `{{version}}`, `{{file}}`, and `{{revision}}` variables. Primarily for apps and CDN-hosted assets—not needed for SDK packages installed from public registries (npm, PyPI, etc.) |
| `linkPrereleases` | By default, the registry target is skipped when the version is a pre-release (e.g. `1.0.0-beta.1`). Set to `true` to publish registry entries for pre-releases as well.                                                                           |
| `checksums`       | List of checksum configs (see [Checksum Configuration](#checksum-configuration))                                                                                                                                                                  |
| `onlyIfPresent`   | Only run if artifact matches the given filename pattern                                                                                                                                                                                           |
| `name`            | Human-readable name for the platform or package (e.g. `"Sentry Browser SDK"` or `"Sentry Craft"`) - (used when creating new packages)                                                                                                             |
| `sdkName`         | SDK identifier matching the SDK's `sdk_info.name` field in Sentry events (e.g., `sentry.javascript.react`). Will create the `sdks/` symlink. (used when creating new packages)                                                                    |
| `packageUrl`      | Link to the package registry page (e.g. npmjs.com, PyPI, crates.io). Not required for `app` types (used when creating new packages)                             |
| `mainDocsUrl`     | Link to the main documentation page. If omitted, Craft falls back to `repo_url` and emits a warning. (used when creating new packages)                                                                                                            |
| `apiDocsUrl`      | Link to the API documentation (e.g. pkg.go.dev, javadoc.io) - (used when creating new packages)                                                                                                                                                   |

### Checksum Configuration

```yaml
checksums:
  - algorithm: sha256 # or sha384, sha512
    format: hex # or base64
```

## How a registry entry is built

Every time Craft publishes a release, it writes a version file (e.g. `packages/npm/@sentry/browser/1.2.3.json`) to the registry. The fields in that file come from different sources:

| Registry field  | `.craft.yml` option | Source                                                                                              |
|-----------------|---------------------|-----------------------------------------------------------------------------------------------------|
| `canonical`     | _(dict key)_        | The dict key in `.craft.yml` (e.g. `npm:@sentry/browser`). Set once on first publish (not updated). |
| `version`       | _(automatic)_       | The release version being published                                                                 |
| `created_at`    | _(automatic)_       | The current timestamp at publish time                                                               |
| `repo_url`      | _(automatic)_       | Auto-detected from the `origin` git remote. Overwritten on every publish                            |
| `name`          | `name`              | Your `.craft.yml` config. Applied on every publish, can be updated at any time                      |
| `package_url`   | `packageUrl`        | Your `.craft.yml` config. Applied on every publish, can be updated at any time                      |
| `main_docs_url` | `mainDocsUrl`       | Your `.craft.yml` config. Applied on every publish, can be updated at any time                      |
| `api_docs_url`  | `apiDocsUrl`        | Your `.craft.yml` config. Applied on every publish, can be updated at any time                      |

The `canonical` field is the only one that cannot be changed after the first publish—it is written once and then validated for consistency on every subsequent run. To rename a canonical, you must manually update both the registry and your `.craft.yml` at the same time.

`repo_url` is always resolved automatically and cannot be configured per-package. By default, Craft reads the `origin` git remote (both HTTPS and SSH formats are supported). If auto-detection is not possible, configure it via a top-level `github` block:

```yaml
github:
  owner: getsentry
  repo: sentry-javascript
```

## Adding a new package

When a package does not yet exist in the registry, Craft creates the directory structure and initial manifest automatically on the first publish. No manual registry changes are needed.

For this to succeed, certain fields must be present in your `.craft.yml` before you publish for the first time.

:::caution[Required metadata on first publish]

- **`name`** — required for all package types.
- **`mainDocsUrl`** — required for all package types. If omitted, Craft falls back to `repo_url` and emits a warning, but you should always set it explicitly.

- **`sdkName`** — required for SDK packages.
- **`packageUrl`** — required for SDK packages
:::

After the first publish, you can add or update any of these fields in `.craft.yml` and they will be applied to the manifest on the next release.

### Example: New SDK package

A package uploaded to public registries (PyPI, NPM, etc.)

```yaml
targets:
  - name: registry
    sdks:
      'npm:@sentry/wasm':
        name: 'Sentry WASM'
        sdkName: 'sentry.javascript.wasm'
        packageUrl: 'https://www.npmjs.com/package/@sentry/wasm'
        mainDocsUrl: 'https://docs.sentry.io/platforms/javascript/'
        # Optional fields for SDKs with API docs:
        apiDocsUrl: 'https://pkg.go.dev/github.com/getsentry/sentry-go'
```

### Example: New App with downloadable artifacts

A standalone application with version files in the registry

```yaml
targets:
  - name: registry
    apps:
      'app:craft':
        name: 'Sentry Craft'
        mainDocsUrl: 'https://github.com/getsentry/craft'
        urlTemplate: 'https://downloads.sentry-cdn.com/craft/{{version}}/{{file}}'
        checksums:
          - algorithm: sha256
            format: hex
```
