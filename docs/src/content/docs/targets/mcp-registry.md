---
title: MCP Registry
description: Publish an MCP server to the official MCP Registry
---

Publishes an MCP server's `server.json` to the [MCP Registry](https://registry.modelcontextprotocol.io), the directory MCP clients and marketplaces use to discover servers.

The target calls the registry's HTTP API directly (the same endpoints [`mcp-publisher`](https://github.com/modelcontextprotocol/registry/tree/main/cmd/publisher) uses). It does not download or need `mcp-publisher`.

## Configuration

| Option | Description |
|--------|-------------|
| `manifest` | Path to the `server.json` manifest, relative to the repository root (also inside a workspace). Default: `server.json` |
| `registryUrl` | Registry base URL. Default: `https://registry.modelcontextprotocol.io` |

The server name comes from the manifest's `name`.

## Authentication

By default, the target uses GitHub Actions OIDC, so no secret is needed. The publishing job needs the `id-token: write` permission. The registry grants OIDC tokens publish access to the `io.github.<owner>/*` namespace of the repository that runs the workflow.

Without OIDC, the target exchanges a GitHub token for a registry token instead:

| Name | Required | Description |
|------|----------|-------------|
| `MCP_GITHUB_TOKEN` | No | GitHub token whose user can publish to the server's `io.github.<owner>/*` namespace. Used only when GitHub Actions OIDC is not available. |

## Default Behavior

For the release version, the target:

1. Reads the manifest and sets `version` and every `packages[].version` to the release version. The file in the repository is not changed.
2. For each `npm` package in the manifest, waits briefly for npm to serve that exact version, then checks that its `mcpName` equals the manifest `name`. The registry rejects npm packages without a matching `mcpName`.
3. Looks up that version in the registry. Registry versions are immutable:
   - If it is already listed and matches the manifest, the target does nothing. Re-running a release is safe.
   - If it is listed but differs from the manifest, the target fails. Release a new version instead.
4. Authenticates and publishes the manifest.
5. Checks that the new listing matches the manifest (ignoring `$schema`) and is `active`.

In dry-run mode, the target still runs the read-only checks, but does not wait for npm, authenticate, or publish.

## Example

List `mcp-registry` after `npm`, so the package is on npm before the registry checks it:

```yaml
targets:
  - name: npm
  - name: mcp-registry
    manifest: server.json # default
```

The npm package's `package.json` must declare the server name:

```json
{
  "name": "@sentry/mcp-server",
  "mcpName": "io.github.getsentry/sentry-mcp"
}
```

### GitHub Actions permissions

```yaml
permissions:
  contents: read
  id-token: write
```
