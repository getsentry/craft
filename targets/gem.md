---
title: "Ruby Gems"
description: "Publish gems to RubyGems"
url: "https://craft.sentry.dev/targets/gem/"
---

# Ruby Gems

Pushes a gem to [RubyGems](https://rubygems.org).

## Configuration

No additional configuration options.

## Environment Variables

| Name | Description |
| --- | --- |
| `GEM_BIN` | Path to `gem` executable. Default: `gem` |

## Example

```yaml
targets:
  - name: gem
```


## Notes

- `gem` must be installed on the system
- You must be logged in with `gem login`

## Navigation

- [Docs home](https://craft.sentry.dev/index.md)
- [Parent: Targets Overview](https://craft.sentry.dev/targets.md)
- [Previous: Google Cloud Storage](https://craft.sentry.dev/targets/gcs.md)
- [Next: GitHub Pages](https://craft.sentry.dev/targets/gh-pages.md)
