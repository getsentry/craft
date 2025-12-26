---
title: pub.dev
description: Publish Dart/Flutter packages to pub.dev
---

Pushes a new Dart or Flutter package to [pub.dev](https://pub.dev/).

## Setup

Because there is [no automated way](https://github.com/dart-lang/pub-dev/issues/5388) to obtain tokens, you must perform a valid release manually first for each package. This generates credentials at:

- macOS: `$HOME/Library/Application Support/dart/pub-credentials.json`
- Linux: `$HOME/.config/dart/pub-credentials.json`
- Or: `$HOME/.pub-cache/credentials.json`

## Configuration

| Option | Description |
|--------|-------------|
| `dartCliPath` | Path to Dart CLI. Default: `dart` |
| `packages` | List of package directories (for monorepos) |
| `skipValidation` | Skip analyzer and dependency checks |

## Environment Variables

| Name | Description |
|------|-------------|
| `PUBDEV_ACCESS_TOKEN` | Value of `accessToken` from credentials file |
| `PUBDEV_REFRESH_TOKEN` | Value of `refreshToken` from credentials file |

## Examples

### Single Package

```yaml
targets:
  - name: pub-dev
```

### Multiple Packages (Monorepo)

```yaml
targets:
  - name: pub-dev
    packages:
      uno:
      dos:
      tres:
```

### Skip Validation

Use cautiously—this skips analyzer checks:

```yaml
targets:
  - name: pub-dev
    skipValidation: true
```
