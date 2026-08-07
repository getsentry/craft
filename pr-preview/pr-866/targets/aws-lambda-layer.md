---
title: "AWS Lambda Layer"
description: "Publish Lambda layers to all AWS regions"
url: "https://craft.sentry.dev/pr-preview/pr-866/targets/aws-lambda-layer/"
---

# AWS Lambda Layer

Creates a new public Lambda layer in each available AWS region and updates the Sentry release registry.

## Configuration

| Option | Description |
| --- | --- |
| `layerName` | Name of the Lambda layer. Supports template variables (see below) |
| `compatibleRuntimes` | List of runtime configurations |
| `compatibleArchitectures` | Optional list of instruction set architectures (`x86_64`, `arm64`) |
| `license` | Layer license |
| `linkPrereleases` | Publish layers for preview/pre-release versions. Default: `false` |
| `includeNames` | Must filter to exactly one artifact |

Pre-release Versions

Layer publication is automatically skipped for pre-release versions (e.g., `1.0.0-alpha.1`, `2.0.0-rc.1`) unless `linkPrereleases` is set to `true`. This prevents unstable versions from being published to all AWS regions.

### Layer Name Templating

The `layerName` option supports Mustache-style template variables for dynamic version interpolation:

| Variable | Description | Example (for v10.2.3) |
| --- | --- | --- |
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
compatibleArchitectures:
  - x86_64
  - arm64
```


## Environment Variables

| Name | Description |
| --- | --- |
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
          - nodejs22.x
          - nodejs24.x
    compatibleArchitectures:
      - x86_64
      - arm64
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

## Navigation

- [Docs home](https://craft.sentry.dev/pr-preview/pr-866/index.md)
- [Parent: Targets Overview](https://craft.sentry.dev/pr-preview/pr-866/targets.md)
- [Next: Homebrew](https://craft.sentry.dev/pr-preview/pr-866/targets/brew.md)
