---
title: CocoaPods
description: Publish pods to CocoaPods
---

Pushes a new podspec to the central CocoaPods repository. The podspec is fetched from the GitHub repository at the release revision.

## Configuration

| Option | Description |
|--------|-------------|
| `specPath` | Path to the Podspec file in the repository |

## Environment Variables

| Name | Description |
|------|-------------|
| `COCOAPODS_TRUNK_TOKEN` | Access token for CocoaPods account |
| `COCOAPODS_BIN` | Path to `pod` executable |

## Example

```yaml
targets:
  - name: cocoapods
    specPath: MyProject.podspec
```

## Notes

- The `cocoapods` gem must be installed on the system
- No release artifacts are required for this target
