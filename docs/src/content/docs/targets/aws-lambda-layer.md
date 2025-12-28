---
title: AWS Lambda Layer
description: Publish Lambda layers to all AWS regions
---

Creates a new public Lambda layer in each available AWS region and updates the Sentry release registry.

## Configuration

| Option | Description |
|--------|-------------|
| `layerName` | Name of the Lambda layer. Supports template variables (see below) |
| `compatibleRuntimes` | List of runtime configurations |
| `license` | Layer license |
| `linkPrereleases` | Update for preview releases. Default: `false` |
| `includeNames` | Must filter to exactly one artifact |

### Layer Name Templating

The `layerName` option supports Mustache-style template variables for dynamic version interpolation:

| Variable | Description | Example (for v10.2.3) |
|----------|-------------|----------------------|
| `{{{version}}}` | Full version string | `10.2.3` |
| `{{{major}}}` | Major version number | `10` |
| `{{{minor}}}` | Minor version number | `2` |
| `{{{patch}}}` | Patch version number | `3` |

This is useful when you want the layer name to reflect the SDK major version, making it easier for users to identify which version the layer supports.

Example: `SentryNodeServerlessSDKv{{{major}}}` becomes `SentryNodeServerlessSDKv10` when publishing version `10.2.3`.

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

## Examples

### Basic Example

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

### With Version Templating

Include the major version in the layer name so users can easily identify SDK compatibility:

```yaml
targets:
  - name: aws-lambda-layer
    includeNames: /^sentry-node-serverless-\d+(\.\d+)*\.zip$/
    layerName: SentryNodeServerlessSDKv{{{major}}}
    compatibleRuntimes:
      - name: node
        versions:
          - nodejs18.x
          - nodejs20.x
    license: MIT
```

When publishing version `10.2.3`, the layer will be named `SentryNodeServerlessSDKv10`.
