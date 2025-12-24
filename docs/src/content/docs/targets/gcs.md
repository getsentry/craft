---
title: Google Cloud Storage
description: Upload artifacts to GCS buckets
---

Uploads artifacts to a bucket in Google Cloud Storage.

## Configuration

| Option | Description |
|--------|-------------|
| `bucket` | GCS bucket name |
| `paths` | List of path objects |
| `paths.path` | Bucket path with `{{ version }}` and/or `{{ revision }}` templates |
| `paths.metadata` | Optional metadata for uploaded files |

## Environment Variables

| Name | Description |
|------|-------------|
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
