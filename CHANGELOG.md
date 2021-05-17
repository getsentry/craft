# Changelog

## 0.22.1

- fix(cli): Fix global flag parsing interference (#235)

## 0.22.0

- feat(config): Automatically detect GitHub config when missing (#208)
- feat: Add upm target (#209)
- ci: Fix our build matrix, add Node 14 & 16 (#211)
- build: Fix and simplify jest and TS configs (#210)
- upgrade(ts-jest): Upgrade ts-jest to latest version (#212)
- feat: Add projectPath config option to GitHub (#220)
- feat: Add config CLI command (#221)
- feat(prepare): Add rev option to base a release on (#223)
- ref: Unify global flags (#224)
- fix(github-artifacts): Allow multiple artifacts on the SHA, use latest (#226)

## 0.21.1

- fix: Upgrade simple-git to latest version (#207)

## 0.21.0

- fix: No prod dependencies (#204)
- build: Move to single-file builds for craft (#203)
- fix(github): Revert retry on 404s (#199)
- fix(gcs): Fix GCS artifact provider on Windows (#200)
- feat(config): Use GitHub as default provider (#202)

  **Breaking Change:** This version changes the default configuration values for
  `statusProvider` and `artifactProvider` to `github` if `minVersion` is greater
  or equal to `0.21.0`. If your craft configuration file does not set these
  providers explicitly, you can keep the old behavior by modifying your config:

  ```yaml
  minVersion: 0.21.0
  artifactProvider:
    name: zeus
  statusProvider:
    name: zeus
  ```

  Support for Zeus will be dropped in a future release and we highly recommend
  updating your CI workflows to use GitHub.

## 0.20.0

- fix(publish): Fix publishing when resuming from a state file (#197)
- ref(logger): Move some extra info to debug level (#198)

## 0.19.0

- fix(registry): Ensure up-to-date remote before pushing (#186, #188)
- feat(publish): Store and restore publish state (#192)
- feat(cli): Add a new targets command (#193)

## 0.18.0

- feat(github): Retry on 404s (#177)
- ref(aws-lambda): Catch potential exceptions when publishing AWS Lambda layers to new regions (#178)
- feat(aws-lambda): Add runtime names on commit message (#181)
- feat(registry): Allow colons as separators in canonical names (#183)

## 0.17.2

- fix(registry): `undefined` handling when there's no `checksums` in `.craft.yml` (#175)

## 0.17.1

- fix(registry): Replace the actual versionFilePath (#174)

## 0.17.0

- feat(aws-lambda): Update the sentry release registry with AWS Lambda layer versions (#172)

## 0.16.1

- fix(gcs-target): Fix incorrect upload path to GCS when it has a leading slash (#170)

## 0.16.0

- feat(aws-lambda): AWS Lambda layer target (#160)

## 0.15.0

- fix(publish): Fix fail on dry-run w/ github target (#152)
- feat(docker): Support cocoapods in the docker container (#153)
- ref(github): GitHub standardized on GITHUB_TOKEN so let's use that (#154)

## 0.14.0

- feat(publish): Add support for optional post-release script (#144)
- fix(publish): Fix error when special target 'all' is used (#142)

## 0.13.3

- fix(publish): Only allow valid target ids for -t (#137)
- fix(changelog): Support subheadings (#139)
- doc(docker): Mention access token instead of password (#140)

## 0.13.2

- fix: npm package

## 0.13.1

- fix: npm token usage (#134) kinda reverting (#130)

## 0.13.0

- feat: Github Artifact Provider (#121)

## 0.12.0

- feat(docker): Add sourceFormat & targetFormat options (#125)
- feat(targets): Add optional `id` field to target config (#128)
- fix(npm): Actually use NPM_TOKEN for publishing (#130)

## 0.11.1

- fix(gcs): Better error serialization (#120)
- fix(github): Detect skipped status checks and Github actions runs as successful (#124)

## 0.11.0

- build: Migrate from tslint to eslint (#113)
- fix: Add stronger types for module exports (#114)
- fix(github): Don't fail when there are queued check suites (#117)
- feat: Add support for `gem` target (#119)

## 0.10.1

- build(ci): Have better defaults for CI environments (#110)
- build(docker): Upgrade cargo to a recent version (#104)
- feat(gha): Add GitHub Action for Craft (#103)
- docs: Fix `changelogPolicy` enum (#102)
- build(docker): Add a `craft` binary into the Docker image (#101)
- docs: Fix `artifactProvider` example (#100)
- feat(crates): Add a `noDevDeps` option (#112)
- fix(crates): Detect stale upload caches and retry (#98)

## 0.10.0

- feat(changelog): Add "auto" changeset policy (#93)
- fix(github): Ignore pending response from legacy commit check API (#94)
- fix(zeus): Don't force ZEUS_API_TOKEN when Zeus is not used (#97)
- feat(target): Add "docker" target (#95)
- fix(logger): Logger should respect log level from env file (#96)

## 0.9.6

- feat: Add a `releaseBranchPrefix` config attribute (#86)

## 0.9.5

- feat: Cocoapods Target add `--allow-warnings` by default
- fix: Localized git branch checks (#84)

## 0.9.4

- fix(gcs): Fix content-types issues (#78)

## 0.9.3

- ref: Remove the need for `COCOAPODS_TRUNK_TOKEN` to be in the environment (#72)

## 0.9.2

- feat: Artifact provider abstraction (#52, #54)
- feat: Support for custom remote names (#43)
- ref: Create GCS API module (#63)
- ref: Create environment utils module (#60)
- chore: Hard-pin runtime dependencies, remove node-emoji and node-dryrun (#53, #58, #65)

## 0.9.1

- fix: Default status provider should still be Zeus
- fix: Handling of undefined command line arguments (#40)

## 0.9.0

- feat: Add new `statusProvider` option
- feat: Make artifact check optional (#36)

## 0.8.4

- gcs: fix shallow copy issue with upload parameters

## 0.8.3

- github: add missing dry-run check

## 0.8.2

- registry: add onlyIfPresent attribute
- Limit concurrent downloads for some targets

## 0.8.1

- Pin octokit dependency

## 0.8.0

- registry: checksums can be added to registry entries
- Add "requireNames" attribute

## 0.7.10

- gcs: add charsets to content-type
- Disable advanced ctrl-c behavior by default

## 0.7.9

- gcs: use explicit content-type for specific file types

## 0.7.8

- npm: use "next" tag when publishing pre-releases (#20)

## 0.7.7

- registry: do not update the "latest" symlink if the new version is older

## 0.7.6

- crates: support submodules when publishing (#18)

## 0.7.5

- npm: allow using "yarn"
- npm: allow to specify OTP for publishing
- Log errors to Sentry

## 0.7.4

- github: strip date from release title
- pre-release command: empty string skips the run

## 0.7.3

- gcs/github: add retries
- Rename "release" step to "prepare"
- Display artifact size before publishing
- Upgrade GCS/GitHub dependencies

## 0.7.2

- Change prompt type when publishing
- Read environment configuration from the project root, and not from the current directory
- Warn about insecure environment files
- gh-pages: Add version to commit message
- Change minimal supported NPM version to 5.6.0
- Fix artifact sorting

## 0.7.1

- Read environment from .craft.env
- Show summary of available artifacts before publishing
- Always print Zeus links when publishing
- Add "--no-input" and "--dry-run" as CLI arguments

## 0.7.0

- Create annotated tags by default

## 0.6.1

- Require additional ctrl-c when running "publish"
- Checkout master after successfull "craft release"
- Fix "registry" issue with prereleases

## 0.6.0

- Replace "maxCacheAge" with more generic "metadata" attribute in "gcs" target
- Add "cocoapods" target

## 0.5.2

- Conditional execution for "registry" targets
- Minor error message fixes

## 0.5.1

- Add minVersion attribute to the configuration file

## 0.5.0

- Add Sentry Release Registry ("registry") target
- Change template engine to Mustache
- Add additional polling for unfinished and non-existing builds

## 0.4.11

- Add GitHub Pages ("gh-pages") target
- Add Google Cloud Storage ("gcs") target
- Add update notifier

## 0.4.10

- Fix PATH issue with "crates" target
- Add a missing check for `ZEUS_API_TOKEN`

## 0.4.9

- Add "crates" target for publishing Rust packages

## 0.4.8

- Fix encoding issue for NPM target

## 0.4.7

- Check for executables when doing "publish"
- Improve support for interactive pre-release scripts

## 0.4.3

- Basic changelog management

## 0.1.2

- Basic "release" functionality

## 0.1.1

- Basic "publish" functionality for GitHub and NPM
