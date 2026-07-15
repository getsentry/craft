---
title: Cloudflare
description: Deploy static sites or Workers to Cloudflare
---

Deploys a release artifact to Cloudflare, either as a [Cloudflare Pages](https://developers.cloudflare.com/pages/) site or as a [Cloudflare Worker](https://developers.cloudflare.com/workers/) with static assets.

The target extracts a ZIP artifact and shells out to the [`wrangler`](https://developers.cloudflare.com/workers/wrangler/) CLI to perform the deployment. `wrangler` is bundled in the Craft Docker image.

## Configuration

| Option | Description |
|--------|-------------|
| `deployType` | `pages` (default) or `worker`. |
| `projectName` | Cloudflare Pages project name. **Required** when `deployType` is `pages`. |
| `productionBranch` | The Pages project's production branch name. Passed to `wrangler pages deploy --branch` so a release always targets the **production** environment. Default: `main`. This is the Cloudflare environment selector, not your git release branch. |
| `wranglerCliPath` | Path to the `wrangler` binary. Default: `wrangler` (or the `WRANGLER_BIN` env var). |
| `workingDir` | Subdirectory within the extracted artifact to deploy from. For `worker` deploys this is where the `wrangler.toml` lives. |

## Environment Variables

| Name | Description |
|------|-------------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token with permission to deploy Pages/Workers. |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID. |

Both are required. They are passed to `wrangler` via the environment, never on the command line.

## Default Behavior

By default, this target:

1. Looks for a single artifact matching `cloudflare.zip` (or `*-cloudflare.zip`). Override with `includeNames`.
2. Extracts its contents (flattening a single top-level directory if present).
3. Deploys via `wrangler`.

## Example

Cloudflare Pages (static site):

```yaml
targets:
  - name: cloudflare
    deployType: pages
    projectName: my-docs-site
    productionBranch: main
```

Cloudflare Worker (with a `wrangler.toml` in the artifact):

```yaml
targets:
  - name: cloudflare
    deployType: worker
    workingDir: worker
```

## Workflow

1. Create a `cloudflare.zip` artifact in your CI workflow (e.g. the built static site, or your Worker plus `wrangler.toml`).
2. Configure the target in `.craft.yml`.
3. Set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in your environment.
