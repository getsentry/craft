---
title: "Google Cloud Storage"
description: "Upload artifacts to GCS buckets"
url: "https://craft.sentry.dev/targets/gcs/"
---

# Google Cloud Storage

Uploads artifacts to a bucket in Google Cloud Storage.

## Configuration

| Option | Description |
| --- | --- |
| `bucket` | GCS bucket name |
| `paths` | List of path objects |
| `paths.path` | Bucket path with `{{ version }}` and/or `{{ revision }}` templates |
| `paths.metadata` | Optional metadata for uploaded files |

## Environment Variables

| Name | Description |
| --- | --- |
| `CRAFT_GCS_TARGET_CREDS_PATH` | Path to Google Cloud credentials file |
| `CRAFT_GCS_TARGET_CREDS_JSON` | Service account file contents as JSON string |

If both are set, `CRAFT_GCS_TARGET_CREDS_JSON` takes precedence.

## Example

```yaml
targets:
  - name: gcs
    bucket: bucket-name
    paths:
      - path: release/{{version}}/download
        metadata:
          cacheControl: 'public, max-age=3600'
      - path: release/{{revision}}/platform/package
```


## Default Metadata

By default, files are uploaded with:

```yaml
cacheControl: 'public, max-age=300'
```

## Navigation

- [Docs home](https://craft.sentry.dev/index.md)
- [Parent: Targets Overview](https://craft.sentry.dev/targets.md)
- [Previous: Docker](https://craft.sentry.dev/targets/docker.md)
- [Next: Ruby Gems](https://craft.sentry.dev/targets/gem.md)
