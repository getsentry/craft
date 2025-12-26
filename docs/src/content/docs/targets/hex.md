---
title: Hex
description: Publish Elixir/Erlang packages to Hex
---

Pushes a package to [Hex](https://hex.pm), the package manager for Elixir and Erlang.

## Configuration

No additional configuration options.

## Environment Variables

| Name | Description |
|------|-------------|
| `HEX_API_KEY` | API key from hex.pm account |
| `MIX_BIN` | Path to `mix` executable. Default: `mix` |

## Example

```yaml
targets:
  - name: hex
```

## Notes

- `mix` (bundled with Elixir) must be installed on the system
