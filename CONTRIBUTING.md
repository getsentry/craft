# Contributing

## Setup

Craft uses pnpm for managing its dependencies. We also rely on
[Volta](https://volta.sh/) to manage our Node and pnpm versions. We highly
recommend installing Volta if you don't already have it.

Then, to get started, install the dependencies and get an initial build:

```shell
pnpm install
pnpm build
```

## Logging Level

Logging level for `craft` can be configured via setting the `CRAFT_LOG_LEVEL`
environment variable or using the `--log-level` CLI flag.

Accepted values are: `Fatal`, `Error`, `Warn`, `Log`, `Info`, `Success`,
`Debug`, `Trace`, `Silent`, `Verbose`

## Dry-run Mode

Dry-run mode can be enabled via setting the `CRAFT_DRY_RUN` environment variable
to any truthy value (any value other than `undefined`, `null`, `""`, `0`,
`false`, and `no`). One may also use the `--dry-run` CLI flag.

In dry-run mode no destructive actions will be performed (creating remote
branches, pushing tags, committing files, etc.)

## Sentry Support

Errors you encounter while using Craft can be sent to Sentry. To use this
feature, add `CRAFT_SENTRY_DSN` variable to your environment (or "craft"
configuration file) that contains a Sentry project's DSN.

For example:

```shell
export CRAFT_SENTRY_DSN='https://1234@sentry.io/2345'
```

## Releasing

`craft` obviously uses itself for preparing and publishing new releases so
[_did you mean recursion_](https://github.com/getsentry/craft/#craft-prepare-preparing-a-new-release)?
