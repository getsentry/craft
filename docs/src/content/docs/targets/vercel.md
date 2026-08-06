---
title: Vercel
description: Deploy a prebuilt static site to Vercel
---

Deploys a release artifact to [Vercel](https://vercel.com/) as a production deployment.

The target extracts a ZIP artifact and deploys it via the Vercel deploy API (using [`@vercel/client`](https://www.npmjs.com/package/@vercel/client)) to promote it to production. It does not use or require the `vercel` CLI.

This target is release-gated: it runs as part of `craft publish`, so a deployment only happens on release and the deployed site stays in sync with the published version — the same guarantee the [`gh-pages`](./gh-pages/) target provides, but for Vercel-hosted sites.

## Configuration

| Option | Description |
|--------|-------------|
| `prebuilt` | Whether the artifact contains a prebuilt `.vercel/output` (the result of `vercel build`). When `true` (default), the artifact's prebuilt `.vercel/output` is uploaded and the remote build step is skipped. Set to `false` to have Vercel build from source. |
| `workingDir` | Subdirectory within the extracted artifact to deploy from. |

## Environment Variables

| Name | Required | Description |
|------|----------|-------------|
| `VERCEL_TOKEN` | Yes | Vercel access token. Passed to the deploy API, never on the command line. |
| `VERCEL_ORG_ID` | No | Vercel organization/team ID. An identifier, not a secret. Forwarded to the deploy API as the team ID so the deployment links non-interactively; when unset, the deploy falls back to the `.vercel/project.json` inside the artifact. |
| `VERCEL_PROJECT_ID` | No | Vercel project ID. An identifier, not a secret. Forwarded to the deploy API to link the deployment to the project; when unset, the deploy falls back to the `.vercel/project.json` inside the artifact. |

:::note
For non-interactive CI deployments, set both `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` (or ship a `.vercel/project.json` in the artifact) so the deploy API knows which project to deploy to.
:::

## Default Behavior

By default, this target:

1. Looks for a single artifact matching `vercel.zip` (or `*-vercel.zip`). Override with `includeNames`.
2. Extracts its contents (preserving the archive layout, e.g. a top-level `.vercel/output`).
3. Deploys to production via the Vercel deploy API.

The version being released is attached to the deployment as metadata (`craftRelease=<version>`) for traceability.

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
