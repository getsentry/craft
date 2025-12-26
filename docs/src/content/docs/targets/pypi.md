---
title: PyPI
description: Publish packages to Python Package Index
---

Uploads source distributions and wheels to the Python Package Index via [twine](https://pypi.org/project/twine/).

## Configuration

No additional configuration options.

## Environment Variables

| Name | Description |
|------|-------------|
| `TWINE_USERNAME` | PyPI username with access rights |
| `TWINE_PASSWORD` | PyPI password |
| `TWINE_BIN` | Path to twine. Default: `twine` |

## Example

```yaml
targets:
  - name: pypi
```

## Sentry Internal PyPI

For Sentry's internal PyPI, use the `sentry-pypi` target which creates a PR to import the package:

```yaml
targets:
  - name: pypi
  - name: sentry-pypi
    internalPypiRepo: getsentry/pypi
```

### Sentry PyPI Configuration

| Option | Description |
|--------|-------------|
| `internalPypiRepo` | GitHub repo containing pypi metadata |

### Sentry PyPI Environment

| Name | Description |
|------|-------------|
| `GITHUB_TOKEN` | GitHub API token |
