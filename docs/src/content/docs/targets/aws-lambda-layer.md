---
title: AWS Lambda Layer
description: Publish Lambda layers to all AWS regions
---

Creates a new public Lambda layer in each available AWS region and updates the Sentry release registry.

## Configuration

| Option | Description |
|--------|-------------|
| `layerName` | Name of the Lambda layer |
| `compatibleRuntimes` | List of runtime configurations |
| `license` | Layer license |
| `linkPrereleases` | Update for preview releases. Default: `false` |
| `includeNames` | Must filter to exactly one artifact |

### Runtime Configuration

```yaml
compatibleRuntimes:
  - name: node
    versions:
      - nodejs10.x
      - nodejs12.x
```

## Environment Variables

| Name | Description |
|------|-------------|
| `AWS_ACCESS_KEY` | AWS account access key |
| `AWS_SECRET_ACCESS_KEY` | AWS account secret key |

## Example

```yaml
targets:
  - name: aws-lambda-layer
    includeNames: /^sentry-node-serverless-\d+(\.\d+)*\.zip$/
    layerName: SentryNodeServerlessSDK
    compatibleRuntimes:
      - name: node
        versions:
          - nodejs10.x
          - nodejs12.x
    license: MIT
```
