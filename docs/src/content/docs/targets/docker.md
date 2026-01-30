---
title: Docker
description: Tag and push Docker images
---

Copies an existing source image tagged with the revision SHA to a new target tagged with the released version. Supports Docker Hub, GitHub Container Registry (ghcr.io), Google Container Registry (gcr.io), and other OCI-compliant registries.

## Configuration

| Option | Description |
|--------|-------------|
| `source` | Source image: string or object with `image`, `registry`, `format`, `usernameVar`, `passwordVar`, `skipLogin` |
| `target` | Target image: string or object (same options as source) |

### Image Object Options

| Property | Description |
|----------|-------------|
| `image` | Docker image path (e.g., `ghcr.io/org/image`) |
| `registry` | Override the registry (auto-detected from `image`) |
| `format` | Format template (see below). Default: `{{{source}}}:{{{revision}}}` for source, `{{{target}}}:{{{version}}}` for target |
| `usernameVar` | Env var name for username |
| `passwordVar` | Env var name for password |
| `skipLogin` | Skip `docker login` for this registry |

### Format Template Variables

| Variable | Description |
|----------|-------------|
| `{{{image}}}` | The `image` value from the current block (source or target) |
| `{{{source}}}` | The source image path |
| `{{{target}}}` | The target image path |
| `{{{revision}}}` | Git revision SHA (source format only) |
| `{{{version}}}` | Release version (target format only) |

## Environment Variables

**Target Registry Credentials** (resolved in order):

1. Explicit `usernameVar`/`passwordVar` from config
2. Registry-derived: `DOCKER_<REGISTRY>_USERNAME/PASSWORD` (e.g., `DOCKER_GHCR_IO_USERNAME`)
3. Built-in defaults for `ghcr.io`: `GITHUB_ACTOR` (or `x-access-token`) and `GITHUB_TOKEN` (or `GITHUB_API_TOKEN`)
4. Fallback: `DOCKER_USERNAME` and `DOCKER_PASSWORD`

| Name | Description |
|------|-------------|
| `DOCKER_USERNAME` | Default username for target registry |
| `DOCKER_PASSWORD` | Default password/token for target registry |
| `DOCKER_BIN` | Path to `docker` executable |
| `GITHUB_TOKEN` | Used for `ghcr.io` authentication (with `GITHUB_ACTOR` as username) |
| `GITHUB_API_TOKEN` | Alternative to `GITHUB_TOKEN` for `ghcr.io` (uses `x-access-token` as username) |

:::tip[GitHub Container Registry]
For `ghcr.io`, Craft automatically uses GitHub Actions environment variables. If `GITHUB_TOKEN` is not available, it falls back to `GITHUB_API_TOKEN` with `x-access-token` as the username, which works with GitHub App installation tokens and PATs.
:::

## Examples

### Docker Hub

```yaml
targets:
  - name: docker
    source: ghcr.io/getsentry/craft
    target: getsentry/craft
```

### GitHub Container Registry (zero-config in GitHub Actions)

```yaml
targets:
  - name: docker
    source: ghcr.io/getsentry/craft
    target: ghcr.io/getsentry/craft
```

### Multiple Registries

```yaml
targets:
  # Docker Hub
  - name: docker
    source: ghcr.io/getsentry/craft
    target: getsentry/craft

  # GHCR
  - name: docker
    source: ghcr.io/getsentry/craft
    target: ghcr.io/getsentry/craft

  # GCR with shared credentials
  - name: docker
    source: ghcr.io/getsentry/craft
    target: us.gcr.io/my-project/craft
    registry: gcr.io
```

### Cross-registry with Explicit Credentials

```yaml
targets:
  - name: docker
    source:
      image: private.registry.io/image
      usernameVar: PRIVATE_REGISTRY_USER
      passwordVar: PRIVATE_REGISTRY_PASS
    target: getsentry/craft
```

### Custom Format with "latest" Tag

```yaml
targets:
  # Versioned tag
  - name: docker
    id: versioned
    source: ghcr.io/getsentry/spotlight
    target: ghcr.io/getsentry/spotlight

  # Latest tag
  - name: docker
    id: latest
    source: ghcr.io/getsentry/spotlight
    target:
      image: ghcr.io/getsentry/spotlight
      format: "{{{image}}}:latest"
```

### Google Cloud Registries

Craft auto-detects Google Cloud registries and uses `gcloud auth configure-docker`:

```yaml
# Works with google-github-actions/auth
targets:
  - name: docker
    source: ghcr.io/myorg/image
    target: us-docker.pkg.dev/my-project/repo/image
```
