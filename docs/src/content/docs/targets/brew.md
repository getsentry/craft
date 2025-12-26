---
title: Homebrew
description: Update Homebrew formulas
---

Pushes a new or updated Homebrew formula to a tap repository. The formula is committed directly to the master branch.

:::note
Formulas on `homebrew/core` are not supported. Use your own tap repository.
:::

## Configuration

| Option | Description |
|--------|-------------|
| `tap` | Homebrew tap name (e.g., `octocat/tools` → `github.com:octocat/homebrew-tools`) |
| `template` | Formula template (Ruby code) with Mustache interpolation |
| `formula` | Formula name. Default: repository name |
| `path` | Path to store formula. Default: `Formula` |

### Template Variables

- `version`: The new version
- `revision`: The tag's commit SHA
- `checksums`: Map of sha256 checksums by filename (dots replaced with `__`, version with `__VERSION__`)

## Environment Variables

| Name | Description |
|------|-------------|
| `GITHUB_TOKEN` | GitHub API token |

## Example

```yaml
targets:
  - name: brew
    tap: octocat/tools
    formula: myproject
    path: HomebrewFormula
    template: >
      class MyProject < Formula
        desc "This is a test for homebrew formulae"
        homepage "https://github.com/octocat/my-project"
        url "https://github.com/octocat/my-project/releases/download/{{version}}/binary-darwin"
        version "{{version}}"
        sha256 "{{checksums.binary-darwin}}"

        def install
          mv "binary-darwin", "myproject"
          bin.install "myproject"
        end
      end
```
