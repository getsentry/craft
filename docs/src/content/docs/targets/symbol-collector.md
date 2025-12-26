---
title: Symbol Collector
description: Upload native symbols to Symbol Collector
---

Uses the [`symbol-collector`](https://github.com/getsentry/symbol-collector) client to upload native symbols.

## Configuration

| Option | Description |
|--------|-------------|
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
