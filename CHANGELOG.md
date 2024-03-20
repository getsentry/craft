# Changelog

## 1.16.0

### Various fixes & improvements

- ref: upgrade node to 20.x (#527) by @asottile-sentry

## 1.15.0

### Various fixes & improvements

- ref: upgrade docker to debian bookworm (#526) by @asottile-sentry

## 1.14.0

### Various fixes & improvements

- ref: upgrade craft to node 18 (#525) by @asottile-sentry

## 1.13.0

### Various fixes & improvements

- ref: fix unzipping larger files in node 18+ (#524) by @asottile-sentry

## 1.12.0

### Various fixes & improvements

- ref: upgrade to node 16 (#523) by @asottile-sentry

## 1.11.1

### Various fixes & improvements

- Install/update `twine` from pypi (#522) by @Swatinem

## 1.11.0

### Various fixes & improvements

- feat: powershell target (#515) by @vaind
- build(deps): bump es5-ext from 0.10.53 to 0.10.63 (#516) by @dependabot

## 1.10.0

### Various fixes & improvements

- Revert "build: Bump Dockerfile base image to node:20-bookworm (#511)" (#513) by @loewenheim

## 1.9.1

### Various fixes & improvements

- upgrade nock (#512) by @asottile-sentry

## 1.9.0

### Various fixes & improvements

- build: Bump Dockerfile base image to node:20-bookworm (#511) by @loewenheim

## 1.8.2

### Various fixes & improvements

- ref: handle comparison of two numeric pre releases (#510) by @asottile-sentry

## 1.8.1

### Various fixes & improvements

- install net7 in addition to net8 (#506) by @bruno-garcia

## 1.8.0

### Various fixes & improvements

- feat(npm): Allow to configure `checkPackageName` for npm target (#504) by @mydea
- Use mainline .NET 8 SDK (#505) by @bruno-garcia
- feat(github): Only set `latest` when new version > old version (#503) by @mydea

## 1.7.0

### Various fixes & improvements

- feat: use dotnet 8 SDK (#501) by @vaind
- Bump CocoaPods from 1.13.0 to 1.14.2 (#497) by @philipphofmann

## 1.6.1

### Various fixes & improvements

- ref: Pin cocoapods version  (#496) by @brustolin

## 1.6.0

### Various fixes & improvements

- feat(commit-on-git-repository): Allow for authentication in github (#495) by @lforst

## 1.5.0

### Various fixes & improvements

- feat: Add `commit-on-git-repository` target (#492) by @lforst
- build(deps): bump semver from 6.3.0 to 6.3.1 (#470) by @dependabot
- build(deps): bump @babel/traverse from 7.22.5 to 7.23.2 (#494) by @dependabot
- ref: remove volta from CI (#493) by @asottile-sentry
- fix: Handle `{major}.json` and `{minor}.json`  symlinks when publishing older versions (#483) by @cleptric
- Bump symbol collector 1.12.0 (#491) by @bruno-garcia

## 1.4.4

### Various fixes & improvements

- fix(brew): Replace version in artifact names with '__VERSION__' to access checksums from mustache (#488) by @romtsn

## 1.4.3

### Various fixes & improvements

- fix typo (#487) by @asottile-sentry
- fix branch trigger for image (#486) by @asottile-sentry
- ref: build docker image using gha (#485) by @asottile-sentry

## 1.4.2

### Various fixes & improvements

- feat(elixir): Use precompiled packages from erlang solutions for elixir (#481) by @sl0thentr0py
- Revert "feat(elixir): Use asdf to install erlang and elixir (#479)" (#480) by @sl0thentr0py
- feat(elixir): Use asdf to install erlang and elixir (#479) by @sl0thentr0py
- ref: add python3-packaging explicitly (#478) by @asottile-sentry
- build(deps): bump word-wrap from 1.2.3 to 1.2.4 (#477) by @dependabot

## 1.4.1

- No documented changes.

## 1.4.0

### Various fixes & improvements

- Revert changes since 1.2.3 (#475) by @mydea
- ref: add python3-packaging explicitly (#474) by @asottile-sentry
- fix(hex): Add erlang-dev for missing parsetools (#473) by @sl0thentr0py

## 1.3.0

### Various fixes & improvements

- feat(build): Bump Dockerfile base image to node:20-bookworm (#472) by @sl0thentr0py

## 1.2.3

### Various fixes & improvements

- fix(hex): Need local.hex --force for compiling deps (#471) by @sl0thentr0py
- ref: update jest (#468) by @asottile-sentry
- build(deps-dev): bump fast-xml-parser from 4.2.4 to 4.2.5 (#467) by @dependabot
- build(deps-dev): bump fast-xml-parser from 3.19.0 to 4.2.4 (#466) by @dependabot

## 1.2.2

### Various fixes & improvements

- Upgrade Flutter to 3.10 in the docker image (#463) by @marandaneto

## 1.2.1

### Various fixes & improvements

- fix missing await when calling uploadKmpPomDistribution (#460) by @buenaflor

## 1.2.0

### Various fixes & improvements

- feat: maven kotlin multiplatform support (#412) by @buenaflor

## 1.1.1

### Various fixes & improvements

- Push nupkg and snupkg together (#459) by @mattjohnsonpint

## 1.1.0

### Various fixes & improvements

- Support nuget snupkg artifacts (#458) by @mattjohnsonpint

## 1.0.1

### Various fixes & improvements

- Fix extracting flutter file to tmp folder instead of current folder (#457) by @marandaneto

## 1.0.0

### Various fixes & improvements

- ref: allow all mounted directories to be considered "safe" (#455) by @asottile-sentry

## 0.35.1

### Various fixes & improvements

- Make Flutter available in the docker image (#453) by @marandaneto
- ref: use --no-document for faster smaller gem install (#454) by @asottile-sentry
- build(deps-dev): bump simple-git from 3.15.0 to 3.16.0 (#448) by @dependabot

## 0.35.0

### Various fixes & improvements

- chore(maven): Increase nexus polling deadline to 60 mins (#450) by @romtsn
- feat: Add hex target for publishing elixir packages (#449) by @sl0thentr0py
- feat(github): Allow to push a tag without a release (#447) by @tonyo
- cleanup(github): Remove mentions of unused annotatedTag (#446) by @tonyo
- document the sentry-pypi target (#444) by @asottile-sentry

## 0.34.3

### Various fixes & improvements

- fix: Publishing podspec depending on other podspec (#442) by @philipphofmann

## 0.34.2

### Various fixes & improvements

- sentry-pypi: get the commit id, not the tree (#441) by @asottile-sentry

## 0.34.1

### Various fixes & improvements

- sentry-pypi: fix trailing whitespace in git output (#440) by @asottile-sentry
- build(deps): bump json5 from 2.1.3 to 2.2.3 (#439) by @dependabot

## 0.34.0

### Various fixes & improvements

- add sentry-pypi target (#438) by @asottile-sentry

## 0.33.8

### Various fixes & improvements

- Emit dotnet and nuget version info (#437) by @mattjohnsonpint
- Bump symbol collector (#435) by @bruno-garcia
- build(deps-dev): bump simple-git from 3.6.0 to 3.15.0 (#436) by @dependabot
- build(deps): bump decode-uri-component from 0.2.0 to 0.2.2 (#434) by @dependabot

## 0.33.7

### Various fixes & improvements

- bump dotnet 7 (#431) by @mattjohnsonpint

## 0.33.6

### Various fixes & improvements

- upgrade minimatch (#429) by @asottile-sentry
- ci(volta-cli): Switch to getsentry/action-setup-volta. This will addr… (#428) by @mattgauntseo-sentry
- Bump action versions (#426) by @mattgauntseo-sentry
- Update actions/upload-artifact to v3.1.1 (#425) by @mattgauntseo-sentry
- build(deps): bump parse-url from 7.0.2 to 8.1.0 (#416) by @dependabot

## 0.33.5

### Various fixes & improvements

- Adding delay between retries for getting artifacts. (#414) by @mattgauntseo-sentry

## 0.33.4

### Various fixes & improvements

- Add additional context to error when version has a 'v' prefix (#411) by @mattgauntseo-sentry

## 0.33.3

### Various fixes & improvements

- bump dotnet 6 (#408) by @bruno-garcia
- ref: actually upgrade node-fetch (#407) by @asottile-sentry
- ref: upgrade yarn dependencies to resolve github security notices (#406) by @asottile-sentry
- build(deps): bump parse-url from 5.0.3 to 7.0.2 (#403) by @dependabot
- build(deps): bump jsdom from 16.4.0 to 16.7.0 (#402) by @dependabot
- build(deps-dev): bump shell-quote from 1.6.1 to 1.7.3 (#401) by @dependabot

## 0.33.2

### Various fixes & improvements

- fix: re-open asset when retrying asset upload (#398) by @asottile-sentry
- ref: Rework how GH artifacts upload retrying works (#397) by @kamilogorek
- ref: Disable Octokit debug logging as its not useful (#397) by @kamilogorek
- ref: Upload GitHub artifacts in parallel (#397) by @kamilogorek

## 0.33.1

### Various fixes & improvements

- fix(crates): Resume workspace publish (#392) by @jan-auer

## 0.33.0

### Various fixes & improvements

- ref: Allow for all logger levels in Octokit (#390) by @kamilogorek
- ref: Upload GitHub artifacts in series (#389) by @kamilogorek

## 0.32.1

### Various fixes & improvements

- ref: Remove spinners from github target artifacts upload (#385) by @kamilogorek

## 0.32.0

### Various fixes & improvements

- upgrade(simple-git): Use latest version, 3.6.0 (#381) by @BYK
- feat(changelog): Limit changes to current project folder (#379) by @BYK
- ci(lint): Make lint job work for external contributors (#378) by @BYK

## 0.31.0

### Increase Release Safety and Reliability (ongoing)

Work on increasing the release safety and reliability.

By: @BYK (#370)

### Various fixes & improvements

- ci: Use better key for getsentry/action-enforce-license-compliance if available (#377) by @chadwhitacre
- Use a custom action (#375) by @chadwhitacre

## 0.30.1

### Various fixes & improvements

- fix: Use `unzipper.Open` to use CentralDirectory instead of local headers (#372) by @kamilogorek

## 0.30.0

### Various fixes & improvements

- deps: Update symbol-collector to 1.5.3 (#363) by @kamilogorek
- ref: Use default branch as merge target instead of parent detection (#355) by @kamilogorek

## 0.29.3

### Various fixes & improvements

- deps: Roll back to symbol-collector 1.4.2 (#362) by @kamilogorek
- meta(gha): Deploy workflow enforce-license-compliance.yml (#360) by @chadwhitacre

## 0.29.2

### Various fixes & improvements

- fix: Make sure dart credentials directory exists before writing (#361) by @kamilogorek

## 0.29.1

### Various fixes & improvements

- feat: Remove dependency_overrides entries from pubspec.yaml in dart (#359) by @kamilogorek
- misc: Update PubDev credentials file location in readme (#358) by @kamilogorek

## 0.29.0

### Various fixes & improvements

- feat: Adds pub.dev target for Dart and Flutter (#353) by @kamilogorek
- misc: Add explanatory code comments and minor refactor for Maven target (#354) by @kamilogorek

## 0.28.1

### Various fixes & improvements

- fix: Correctly set auth header and content-type for Nexus requests (#352) by @kamilogorek

## 0.28.0

### Various fixes & improvements

- feat: Publish maven packages without use of Gradle (#351) by @kamilogorek

## 0.27.6

### Various fixes & improvements

- fix: Make sure that gradle directory exists before writing to it (#349) by @kamilogorek

## 0.27.5

### Increase Release Safety and Reliability (ongoing)

Work on increasing the release safety and reliability.

By: @chadwhitacre (#343)

### Various fixes & improvements

- feat: Unattended GPG signing for Maven target (#346) by @kamilogorek
- Github → GitHub (#347) by @chadwhitacre

## 0.27.4

### Various fixes & improvements

- fix(crates): Skip path-only dev-dependencies in dep cycle checking (#341) by @Swatinem
- Limit the number of leftovers listed (#335) by @chadwhitacre

## 0.27.3

### Various fixes & improvements

- fix: Remove GitHub asset checksum (#333) by @rhcarvalho
- misc: Update error message to clarify what size refers to what (#332) by @rhcarvalho
- build: Use source map to produce debuggable stack traces (#326) by @rhcarvalho

## 0.27.2

### Increase Release Safety and Reliability (ongoing)

Work on increasing the release safety and reliability.

By: @iker-barriocanal (#328)

### Various fixes & improvements

- docs: Fix typos and cleanup some documentation (#325) by @rhcarvalho

## 0.27.1

### Various fixes & improvements

- Relax checksum requirement (#323) by @chadwhitacre
- docs: Remove Github Artifact Provider entry in the README (#321) by @kamilogorek
- ci(release): Omit meta version bumps from changelog (#320) by @BYK
- meta: Bump new development version (d0028539)

## 0.27.0

### Increase Release Safety and Reliability (ongoing)

We recently had an [incident](https://github.com/getsentry/craft/pull/302) where we were uploading broken assets to GitHub releases page. We now verify the uploads to GitHub releases and GCS via hash comparison.

PRs: #318

### Contributors in Automated Changelogs (ongoing)

GitHub automatically generates a "Contributors" section when you mention the contributors on release notes so why not Craft?

PRs: #319

### Various fixes & improvements

- meta: Bump new development version (6f2538ea)

## 0.26.2

### Increase Release Safety and Reliability (ongoing)

We recently had an [incident](https://github.com/getsentry/craft/pull/302) where we were uploading broken assets to GitHub releases page. We now verify the uploads to GitHub releases and GCS via hash comparison.

PRs: #317

### Various fixes & improvements

- meta: Bump new development version (721b750f)

## 0.26.1

### Automated Changelog Fixups

We have fixed some edge cases and a major issue affecting GitHub release logs in our automated changelog generation. These are mostly about how we generated Markdown.

PRs: #316

### Increase Release Safety and Reliability (ongoing)

We recently had an [incident](https://github.com/getsentry/craft/pull/302) where we were uploading broken assets to GitHub releases page. We now verify the uploads to GitHub releases and GCS via hash comparison.

PRs: #315

### Various fixes & improvements

- fix(release): Fix post release script to commit the new version (#312)
- meta: Bump new development version (896ea585)

## 0.26.0

### Increase Release Safety and Reliability (ongoing)

We recently had an [incident](https://github.com/getsentry/craft/pull/302) where we were uploading broken assets to GitHub releases page. We now verify the uploads to GitHub releases and GCS via hash comparison.

PRs: #308, #304

### Various fixes & improvements

- fix(registry): Add missing await to manifest update (#311)
- fix: Only log error on tempdir rm when ther is an error (#309)
- fix: UPM no longer expects exactly 1 artifact (#307)

## 0.25.3

### Various fixes & improvements

- fix: github release uploads (#302)

## 0.25.2

### Automated Changelog Fixups

We have fixed some edge cases and a major issue affecting GitHub release logs in our automated changelog generation. These are mostly about how we generated Markdown.

PRs: #301

### Various fixes & improvements

- docs(changelog): Fix subsections for 0.25.1 (bd1bc975)

## 0.25.1

### Automated Changelog Fixups

We have fixed some edge cases and a major issue affecting GitHub release logs in our automated changelog generation. These are mostly about how we generated Markdown.

PRs: #299, #298, #297, #296, #295

### Various fixes & improvements

- ci(release): Fetch all commits for prev version determination (eabce5ec)
- upgrade(ansi-regex): Upgrade ansi-regex to 5.0.1 (#300)

## 0.25.0

### Automated Changelog Generation

We now automatically generate changelog entries for the `auto` changelog policy where none provided, instead of saying "No documented changes". The commits/PRs are grouped by their associated GitHub milestones and the milestone title and description are used in the changelog along with a list of related commits/PRs. Any unaccounted changes are grouped under the "Various improvements and fixes" section.

PRs: #291, #290, #289, #287, #285

### Added Maven Target (ongoing)

Added the long-awaited Maven target, full with Android support.

PRs: #271, #275, #276, #270, #258

### Added symbol-collector Target

Added target for our very own [symbol-collector](https://github.com/getsentry/symbol-collector/) to collect and upload all native system symbols with Craft.

PRs: #284, #277, #269, #268, #267, #266

### Fixed Cocoapods Support

Turns out our Cocoapods target was a bit outdated and broken. We have fixed it in this release! 🥳

PRs: #281, #282

### Various fixes & improvements

- build: Drop Node 12 support, target Node 14 (#293)
- build(deps): Bump tmpl from 1.0.4 to 1.0.5 (#292)
- ref: Fix TypeScript type warning regarding catch (#288)
- build(deps): Bump set-value from 3.0.2 to 4.1.0 (#286)
- ci: Drop Node 10 support, use Node 14 by default (#283)
- build(deps-dev): Bump tar from 4.4.15 to 4.4.18 (#280)
- build(deps): Bump path-parse from 1.0.6 to 1.0.7 (#274)
- build(deps-dev): Bump tar from 4.4.8 to 4.4.15 (#273)
- docs: Consistent code samples for shell (e84f693f)
- docs: Mention release/\*\* branches on README (#263)

## 0.24.4

- fix(registry): Fix error w/ simple registry config (#262)

## 0.24.3

- upgrade(parse-url): Force parse-url>=5.0.3 for security (#261)

## 0.24.2

- upgrade(js-yaml): Bump to 3.13.1 for security fixes (#260)

## 0.24.1

- fix(registry): Fix onlyIfPresent config on batch (#259)

## 0.24.0

- ref(zeus): Remove all Zeus support (#253)
- fix(registry): Fix empty `files` entries (#256)

## 0.23.1

- fix(git): Ensure origin/HEAD is set (#252)

## 0.23.0

- feat(publish): Ability to merge to non-default (#245)
- fix(logging): Proper scoping and log levels (#247)
- feat(registry-target): Allow batched updates w/ new config (#249)

## 0.22.2

- fix(logging): Fix scoped loggers not respecting log level (#236)
- fix(github-artifacts): Fix incorrect artifact resolution (#237)

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
