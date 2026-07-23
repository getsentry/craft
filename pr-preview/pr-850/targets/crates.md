---
title: "Crates"
description: "Publish Rust packages to crates.io"
url: "https://craft.sentry.dev/pr-preview/pr-850/targets/crates/"
---

# Crates

Publishes a single Rust package or entire workspace to [crates.io](https://crates.io). If the workspace contains multiple crates, they are published in dependency order.

## Configuration

| Option | Description |
| --- | --- |
| `noDevDeps` | Strip `devDependencies` before publishing. Requires [`cargo-hack`](https://github.com/taiki-e/cargo-hack). Default: `false` |

## Environment Variables

| Name | Description |
| --- | --- |
| `CRATES_IO_TOKEN` | Access token for crates.io |
| `CARGO_BIN` | Path to cargo. Default: `cargo` |

## Example

```yaml
targets:
  - name: crates
    noDevDeps: false
```


## Notes

- `cargo` must be installed and configured on the system
- For workspaces, crates are published in topological order based on dependencies

## Navigation

- [Docs home](https://craft.sentry.dev/pr-preview/pr-850/index.md)
- [Parent: Targets Overview](https://craft.sentry.dev/pr-preview/pr-850/targets.md)
- [Previous: Commit on Git Repository](https://craft.sentry.dev/pr-preview/pr-850/targets/commit-on-git-repository.md)
- [Next: Docker](https://craft.sentry.dev/pr-preview/pr-850/targets/docker.md)
