---
title: "Vercel"
description: "Deploy a prebuilt static site to Vercel"
url: "https://craft.sentry.dev/pr-preview/pr-865/targets/vercel/"
---

# Vercel

Deploys a release artifact to [Vercel](https://vercel.com/) as a production deployment.

The target extracts a ZIP artifact and shells out to the [`vercel`](https://vercel.com/docs/cli) CLI to promote it to production (`vercel deploy --prod`). The `vercel` CLI is bundled in the Craft Docker image.

This target is release-gated: it runs as part of `craft publish`, so a deployment only happens on release and the deployed site stays in sync with the published version — the same guarantee the [`gh-pages`](https://craft.sentry.dev/pr-preview/pr-865/targets/vercel/gh-pages.md) target provides, but for Vercel-hosted sites.

## Configuration

| Option | Description |
| --- | --- |
| `prebuilt` | Whether the artifact contains a prebuilt `.vercel/output` (the result of `vercel build`). When `true` (default), the CLI is invoked with `--prebuilt` and skips the remote build. Set to `false` to have Vercel build from source. |
| `vercelCliPath` | Path to the `vercel` binary. Default: `vercel` (or the `VERCEL_BIN` env var). |
| `workingDir` | Subdirectory within the extracted artifact to deploy from. |

## Environment Variables

| Name | Required | Description |
| --- | --- | --- |
| `VERCEL_TOKEN` | Yes | Vercel access token. Passed to the CLI via the environment, never on the command line. |
| `VERCEL_ORG_ID` | No | Vercel organization/team ID. An identifier, not a secret. Forwarded to the CLI to link the deployment non-interactively; when unset, the CLI falls back to the `.vercel/project.json` inside the artifact. |
| `VERCEL_PROJECT_ID` | No | Vercel project ID. An identifier, not a secret. Same behavior as `VERCEL_ORG_ID`. |

Note

For non-interactive CI deployments, set both `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` (or ship a `.vercel/project.json` in the artifact) so the CLI knows which project to deploy to.

## Default Behavior

By default, this target:

1. Looks for a single artifact matching `vercel.zip` (or `*-vercel.zip`). Override with `includeNames`.
2. Extracts its contents (flattening a single top-level directory if present).
3. Deploys to production via `vercel deploy --prod --prebuilt`.

The version being released is attached to the deployment as `--meta craftRelease=<version>` for traceability.

## Example

```yaml
targets:
  - name: vercel
    # prebuilt defaults to true: the docs site is built in CI and this
    # target only promotes the prebuilt output to production.
```


Deploying from a subdirectory of the artifact:

```yaml
targets:
  - name: vercel
    workingDir: docs
```


## Workflow

1. Build the site in CI (e.g. `vercel build`) and create a `vercel.zip` artifact containing the prebuilt `.vercel/output` (or the source when `prebuilt: false`).
2. Configure the target in `.craft.yml`.
3. Set `VERCEL_TOKEN` in your environment, plus `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` (or include a `.vercel/project.json` in the artifact) so the deploy targets the right project.

## Navigation

- [Docs home](https://craft.sentry.dev/pr-preview/pr-865/index.md)
- [Parent: Targets Overview](https://craft.sentry.dev/pr-preview/pr-865/targets.md)
- [Previous: Unity Package Manager](https://craft.sentry.dev/pr-preview/pr-865/targets/upm.md)
