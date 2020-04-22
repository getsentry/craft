# Changelog

## Unreleased

Watch this space...

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
