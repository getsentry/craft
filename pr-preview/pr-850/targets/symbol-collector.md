---
title: "Symbol Collector"
description: "Upload native symbols to Symbol Collector"
url: "https://craft.sentry.dev/pr-preview/pr-850/targets/symbol-collector/"
---

# Symbol Collector

Uses the [`symbol-collector`](https://github.com/getsentry/symbol-collector) client to upload native symbols.

## Configuration

| Option | Description |
| --- | --- |
| `serverEndpoint` | Server endpoint. Default: `https://symbol-collector.services.sentry.io` |
| `batchType` | Symbol batch type: `Android`, `macOS`, `iOS` |
| `bundleIdPrefix` | Prefix for bundle ID (version is appended) |

## Example

```yaml
targets:
  - name: symbol-collector
    includeNames: /libsentry(-android)?\.so/
    batchType: Android
    bundleIdPrefix: android-ndk-
```


## Notes

- The `symbol-collector` CLI must be available in PATH

## Navigation

- [Docs home](https://craft.sentry.dev/pr-preview/pr-850/index.md)
- [Parent: Targets Overview](https://craft.sentry.dev/pr-preview/pr-850/targets.md)
- [Previous: Sentry Release Registry](https://craft.sentry.dev/pr-preview/pr-850/targets/registry.md)
- [Next: Unity Package Manager](https://craft.sentry.dev/pr-preview/pr-850/targets/upm.md)
