---
title: "Hex"
description: "Publish Elixir/Erlang packages to Hex"
url: "https://craft.sentry.dev/targets/hex/"
---

# Hex

Pushes a package to [Hex](https://hex.pm), the package manager for Elixir and Erlang.

## Configuration

No additional configuration options.

## Environment Variables

| Name | Description |
| --- | --- |
| `HEX_API_KEY` | API key from hex.pm account |
| `MIX_BIN` | Path to `mix` executable. Default: `mix` |

## Example

```yaml
targets:
  - name: hex
```


## Notes

- `mix` (bundled with Elixir) must be installed on the system

## Navigation

- [Docs home](https://craft.sentry.dev/index.md)
- [Parent: Targets Overview](https://craft.sentry.dev/targets.md)
- [Previous: GitHub](https://craft.sentry.dev/targets/github.md)
- [Next: Maven](https://craft.sentry.dev/targets/maven.md)
