---
title: "Vercel"
description: "Deploy a prebuilt static site to Vercel"
url: "https://craft.sentry.dev/targets/vercel/"
---

# Vercel

Deploys a release artifact to [Vercel](https://vercel.com/) as a production deployment.

The target extracts a ZIP artifact and deploys it via the Vercel deploy API (using [`@vercel/client`](https://www.npmjs.com/package/@vercel/client)) to promote it to production. It does not use or require the `vercel` CLI.

## Configuration

| Option | Description |
| --- | --- |
| `prebuilt` | Whether the artifact contains a prebuilt `.vercel/output` (the result of `vercel build`). When `true` (default), the artifact’s prebuilt `.vercel/output` is uploaded and the remote build step is skipped. Set to `false` to have Vercel build from source. |
| `workingDir` | Subdirectory within the extracted artifact to deploy from. |

## Environment Variables

| Name | Required | Description |
| --- | --- | --- |
| `VERCEL_TOKEN` | Yes | Vercel access token. Passed to the deploy API, never on the command line. |
| `VERCEL_ORG_ID` | No | Vercel organization/team ID. An identifier, not a secret. Forwarded to the deploy API as the team ID so the deployment links non-interactively. |
| `VERCEL_PROJECT_ID` | No | Vercel project ID. An identifier, not a secret. Forwarded to the deploy API as the project identifier so the deployment links to the intended project non-interactively. |

Note

For non-interactive CI deployments, set both `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` so the deploy API knows which project to deploy to.

## Default Behavior

By default, this target:

1. Looks for a single artifact matching `vercel.zip` (or `*-vercel.zip`). Override with `includeNames`.
2. Extracts its contents (preserving the archive layout, e.g. a top-level `.vercel/output`).
3. Deploys to production via the Vercel deploy API.

The version being released is attached to the deployment as metadata (`release=<version>`) for traceability.

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
3. Set `VERCEL_TOKEN` in your environment, plus `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` so the deploy targets the right project.

## Navigation

- [Docs home](https://craft.sentry.dev/index.md)
- [Parent: Targets Overview](https://craft.sentry.dev/targets.md)
- [Previous: Unity Package Manager](https://craft.sentry.dev/targets/upm.md)
