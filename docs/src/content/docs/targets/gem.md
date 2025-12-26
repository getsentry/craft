---
title: Ruby Gems
description: Publish gems to RubyGems
---

Pushes a gem to [RubyGems](https://rubygems.org).

## Configuration

No additional configuration options.

## Environment Variables

| Name | Description |
|------|-------------|
| `GEM_BIN` | Path to `gem` executable. Default: `gem` |

## Example

```yaml
targets:
  - name: gem
```

## Notes

- `gem` must be installed on the system
- You must be logged in with `gem login`
