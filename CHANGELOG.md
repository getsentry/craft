# Changelog

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
