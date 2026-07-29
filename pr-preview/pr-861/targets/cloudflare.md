---
title: "Cloudflare"
description: "Deploy static sites or Workers to Cloudflare"
url: "https://craft.sentry.dev/pr-preview/pr-861/targets/cloudflare/"
---

# Cloudflare

Deploys a release artifact to Cloudflare, either as a [Cloudflare Worker](https://developers.cloudflare.com/workers/) (optionally with static assets) or as a [Cloudflare Pages](https://developers.cloudflare.com/pages/) site.

The target extracts a ZIP artifact and shells out to the [`wrangler`](https://developers.cloudflare.com/workers/wrangler/) CLI to perform the deployment. `wrangler` is bundled in the Craft Docker image.

Note

`deployType` defaults to `worker`. Cloudflare is steering new projects to Workers (with static assets) and positioning Pages as legacy, so Workers is the forward-looking default. Pages remains fully supported via `deployType: pages`.

## Configuration

| Option | Description |
| --- | --- |
| `deployType` | `worker` (default) or `pages`. |
| `projectName` | Cloudflare Pages project name. **Required** when `deployType` is `pages`. |
| `productionBranch` | The Pages project’s production branch name. Optional — when omitted, Craft reads it from the Cloudflare API so the release lands on production. See [Production deployments](#production-deployments-pages). Only used for `deployType: pages`. |
| `wranglerCliPath` | Path to the `wrangler` binary. Default: `wrangler` (or the `WRANGLER_BIN` env var). |
| `workingDir` | Subdirectory within the extracted artifact to deploy from. For `worker` deploys this is where the `wrangler.toml` lives. |

## Environment Variables

| Name | Required | Description |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | Yes | Cloudflare API token with permission to deploy (Account → Cloudflare Pages → Edit, or the equivalent Workers permissions). Passed to `wrangler` via the environment, never on the command line. |
| `CLOUDFLARE_ACCOUNT_ID` | No | Cloudflare account ID. This is an identifier, not a secret. When unset, `wrangler` auto-discovers it for single-account tokens; set it explicitly if your token can access multiple accounts. |

Note

Cloudflare deployments authenticate with an API token — there is no OIDC/keyless option in `wrangler`, so provide `CLOUDFLARE_API_TOKEN` as a CI secret.

## Production deployments (Pages)

`wrangler pages deploy --branch <X>` deploys to **production** only when `<X>` exactly matches the project’s server-side production branch; any other value silently produces a _preview_ deployment (this is not an error). To make releases reliably land on production, Craft resolves the production branch as follows:

1. If `productionBranch` is set in the config, it is used verbatim.
2. Otherwise, if the account ID is known, Craft reads the project’s production branch from the Cloudflare API (`GET /accounts/{id}/pages/projects/{name}`) — the same call `wrangler` makes internally, so it needs no token scope beyond deploying.
3. If neither is available, Craft omits `--branch`; a bare deploy from Craft’s temporary (non-git) directory defaults to production.

## Default Behavior

By default, this target:

1. Looks for a single artifact matching `cloudflare.zip` (or `*-cloudflare.zip`). Override with `includeNames`.
2. Extracts its contents (flattening a single top-level directory if present).
3. Deploys via `wrangler`.

## Example

Cloudflare Worker (with a `wrangler.toml` in the artifact):

```yaml
targets:
  - name: cloudflare
    deployType: worker
    workingDir: worker
```


Cloudflare Pages (static site):

```yaml
targets:
  - name: cloudflare
    deployType: pages
    projectName: my-docs-site
    # productionBranch is optional; inferred from the API when omitted.
```


## Workflow

1. Create a `cloudflare.zip` artifact in your CI workflow (e.g. your Worker plus `wrangler.toml`, or the built static site for Pages).
2. Configure the target in `.craft.yml`.
3. Set `CLOUDFLARE_API_TOKEN` in your environment (and `CLOUDFLARE_ACCOUNT_ID` if your token can access multiple accounts).

## Navigation

- [Docs home](https://craft.sentry.dev/pr-preview/pr-861/index.md)
- [Parent: Targets Overview](https://craft.sentry.dev/pr-preview/pr-861/targets.md)
- [Previous: Homebrew](https://craft.sentry.dev/pr-preview/pr-861/targets/brew.md)
- [Next: CocoaPods](https://craft.sentry.dev/pr-preview/pr-861/targets/cocoapods.md)
