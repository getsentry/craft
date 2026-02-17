# Changelog

## 2.21.6

### Bug Fixes 🐛

- (changelog) Disable @-mention pings in publish issues for calver releases by @BYK in [#755](https://github.com/getsentry/craft/pull/755)
- (github) Truncate release body exceeding GitHub 125k char limit by @BYK in [#754](https://github.com/getsentry/craft/pull/754)
- (ux) Show failed check details on status provider failures by @BYK in [#756](https://github.com/getsentry/craft/pull/756)

## 2.21.5

### Bug Fixes 🐛

- (action) Write changelog to file to avoid E2BIG on large repos by @BYK in [#753](https://github.com/getsentry/craft/pull/753)
- (gh-pages) Add CNAME file to preserve custom domain on deploy by @BYK in [#751](https://github.com/getsentry/craft/pull/751)

## 2.21.4

### Bug Fixes 🐛

- (ux) Improve error messages for artifact mismatches and missing release branches by @BYK in [#750](https://github.com/getsentry/craft/pull/750)

## 2.21.3

### Bug Fixes 🐛

- (artifacts) Support glob patterns and validate all configured patterns match by @BYK in [#748](https://github.com/getsentry/craft/pull/748)
- (changelog) Tailor preview output to versioning policy by @BYK in [#749](https://github.com/getsentry/craft/pull/749)

### Other

- fix: Retract is no more by @BYK in [1aa1e5c1](https://github.com/getsentry/craft/commit/1aa1e5c18fe59a7ac942e9db68adb1d418da91ac)

## 2.21.2

### Bug Fixes 🐛

- (targets) Add missing spawnProcess imports in pypi and crates by @BYK in [#746](https://github.com/getsentry/craft/pull/746)

### Internal Changes 🔧

- Add TypeScript type checking to CI by @BYK in [#747](https://github.com/getsentry/craft/pull/747)

## 2.21.1

### New Features ✨

- Update publish issue body when re-running GitHub Action by @BYK in [#740](https://github.com/getsentry/craft/pull/740)
- Add noMerge config option with auto-detection for GitHub Actions by @BYK in [#739](https://github.com/getsentry/craft/pull/739)
- Automatic version bumping from configured targets by @BYK in [#707](https://github.com/getsentry/craft/pull/707)
- Configure GitHub artifact provider to filter by workflow and name by @BYK in [#709](https://github.com/getsentry/craft/pull/709)

### Bug Fixes 🐛

- (action) Handle permission errors when updating publish issues by @BYK in [#744](https://github.com/getsentry/craft/pull/744)
- (build) Add legacy artifact name for backward compatibility by @BYK in [#743](https://github.com/getsentry/craft/pull/743)
- (security) Resolve HIGH severity Dependabot alerts by @BYK in [#741](https://github.com/getsentry/craft/pull/741)

### Internal Changes 🔧

#### Deps Dev

- Bump fast-xml-parser from 4.5.3 to 5.3.4 by @dependabot in [#737](https://github.com/getsentry/craft/pull/737)
- Bump tar from 7.5.4 to 7.5.7 by @dependabot in [#736](https://github.com/getsentry/craft/pull/736)

#### Other

- Use correct artifact name for dogfooding by @BYK in [#742](https://github.com/getsentry/craft/pull/742)

### Other

- Revert legacy artifact naming for backward compatibility by @BYK in [#745](https://github.com/getsentry/craft/pull/745)

## 2.20.1

### Bug Fixes 🐛

- (action) Expand changelog by default in publish issues by @BYK in [#731](https://github.com/getsentry/craft/pull/731)

### Documentation 📚

- Update documentation for changes since 2.17.0 by @BYK in [#735](https://github.com/getsentry/craft/pull/735)
- Update base path for craft.sentry.dev domain by @BYK in [#734](https://github.com/getsentry/craft/pull/734)

## 2.20.0

### New Features ✨

#### Github

- Add comment option to changelog-preview workflow by @BYK in [#722](https://github.com/getsentry/craft/pull/722)
- Add working-directory input to changelog-preview workflow by @BYK in [#717](https://github.com/getsentry/craft/pull/717)

### Bug Fixes 🐛

#### Changelog

- Warn when custom release.yml lacks semver fields by @BYK in [#720](https://github.com/getsentry/craft/pull/720)
- Collapse previews by default by @BYK in [#718](https://github.com/getsentry/craft/pull/718)

#### Other

- (action) Fix detection of existing publish issues by @BYK in [#728](https://github.com/getsentry/craft/pull/728)
- (actions) Use repository check instead of event_name for dogfooding conditions by @BYK in [#727](https://github.com/getsentry/craft/pull/727)
- (github) Use pull_request_target for changelog preview on fork PRs by @BYK in [#723](https://github.com/getsentry/craft/pull/723)
- Address security vulnerabilities in dependencies by @BYK in [#725](https://github.com/getsentry/craft/pull/725)

### Documentation 📚

- Document CRAFT_NEW_VERSION and CRAFT_OLD_VERSION for pre-release command by @BYK in [#719](https://github.com/getsentry/craft/pull/719)

### Internal Changes 🔧

#### Deps Dev

- Bump tar from 7.5.3 to 7.5.4 by @dependabot in [#726](https://github.com/getsentry/craft/pull/726)
- Bump tar from 6.2.1 to 7.5.3 by @dependabot in [#724](https://github.com/getsentry/craft/pull/724)

#### Other

- Rename changelog category to "Internal Changes" by @BYK in [#721](https://github.com/getsentry/craft/pull/721)

## 2.19.0

### New Features ✨

- (action) Emit publish request issue URL as annotation by @BYK in [#708](https://github.com/getsentry/craft/pull/708)

### Bug Fixes 🐛

#### Docker

- Add image template var and strict template validation by @BYK in [#713](https://github.com/getsentry/craft/pull/713)
- Add GITHUB_API_TOKEN and x-access-token fallbacks for ghcr.io by @BYK in [#710](https://github.com/getsentry/craft/pull/710)

#### Other

- (action) Use environment variables for complex inputs by @BYK in [#716](https://github.com/getsentry/craft/pull/716)
- (aws-lambda) Skip layer publication for pre-release versions by @BYK in [#714](https://github.com/getsentry/craft/pull/714)
- (prepare) Make NEW-VERSION optional and auto-create changelog by @BYK in [#715](https://github.com/getsentry/craft/pull/715)
- Don't mention PRs to avoid linking in changelog previews by @BYK in [#712](https://github.com/getsentry/craft/pull/712)

## 2.18.3

### Bug Fixes 🐛

- (changelog-preview) Replace deleted install sub-action with inline install by @BYK in [#706](https://github.com/getsentry/craft/pull/706)

## 2.18.2

### Bug Fixes 🐛

#### Action

- Simplify install by using build artifact with release fallback by @BYK in [#705](https://github.com/getsentry/craft/pull/705)
- Resolve install sub-action path for external repos by @BYK in [#704](https://github.com/getsentry/craft/pull/704)

## 2.18.1

### Bug Fixes 🐛

- (changelog) Add retry and robust error handling for GitHub GraphQL by @seer-by-sentry in [#701](https://github.com/getsentry/craft/pull/701)
- Add permissions and docs for changelog-preview reusable workflow by @BYK in [#703](https://github.com/getsentry/craft/pull/703)

## 2.18.0

### New Features ✨

- (dry-run) Add worktree-based dry-run mode with real diff output by @BYK in [#692](https://github.com/getsentry/craft/pull/692)

### Bug Fixes 🐛

- (brew) Skip prereleases and add mustache templating for formula names by @BYK in [#682](https://github.com/getsentry/craft/pull/682)

### Build / dependencies / internal 🔧

- Add comprehensive Sentry integration with tracing and source maps by @BYK in [#697](https://github.com/getsentry/craft/pull/697)
- Migrate from Yarn to pnpm 10.27.0 by @BYK in [#693](https://github.com/getsentry/craft/pull/693)

## 2.17.0

### New Features ✨

- (registry) Auto-create package structure for new packages by @BYK in [#689](https://github.com/getsentry/craft/pull/689)

### Bug Fixes 🐛

#### Changelog

- Deduplicate merged PR entries in preview by @BYK in [#690](https://github.com/getsentry/craft/pull/690)
- Disable author mentions in PR preview comments by @BYK in [#684](https://github.com/getsentry/craft/pull/684)

#### Other

- (github) Clean up orphaned draft releases on publish failure by @BYK in [#681](https://github.com/getsentry/craft/pull/681)
- (publish) Fail early on dirty git repository by @BYK in [#683](https://github.com/getsentry/craft/pull/683)

### Documentation 📚

- Improve documentation and CLI messages for new users by @BYK in [#691](https://github.com/getsentry/craft/pull/691)

### Build / dependencies / internal 🔧

- Centralize dry-run logic with Proxy-based abstraction by @BYK in [#685](https://github.com/getsentry/craft/pull/685)

## 2.16.0

### New Features ✨

#### Changelog

- Strip commit patterns from changelog entries by @BYK in [#674](https://github.com/getsentry/craft/pull/674)
- Add support for custom changelog entries from PR descriptions by @szokeasaurusrex in [#648](https://github.com/getsentry/craft/pull/648)
- And with support for multiple entries by @szokeasaurusrex in [#648](https://github.com/getsentry/craft/pull/648)
  - and nested items
- Add changelog preview action and CLI command by @BYK in [#669](https://github.com/getsentry/craft/pull/669)

#### Other

- (actions) Make release workflow reusable for external repos by @BYK in [#672](https://github.com/getsentry/craft/pull/672)
- (aws-lambda) Add version templating for layer names by @BYK in [#678](https://github.com/getsentry/craft/pull/678)

### Bug Fixes 🐛

#### Changelog

- Handle reverts in changelog and version inference by @BYK in [#677](https://github.com/getsentry/craft/pull/677)
- Use PR-specific bump type in preview by @BYK in [#676](https://github.com/getsentry/craft/pull/676)

### Documentation 📚

- New documentation site! by @BYK in [#668](https://github.com/getsentry/craft/pull/668)

## 2.15.0

### New Features ✨

#### Github

- feat(github): Integrate action-prepare-release into Craft repo by @BYK in [#667](https://github.com/getsentry/craft/pull/667)
- feat(github): Emit resolved version to GITHUB_OUTPUTS on prepare by @BYK in [#666](https://github.com/getsentry/craft/pull/666)

## 2.14.1

### Bug Fixes 🐛

#### Changelog

- fix(changelog): Fix whitespace related issues by @BYK in [#664](https://github.com/getsentry/craft/pull/664)
- fix(changelog): Add ref and perf to internal changes prefixes by @BYK in [#662](https://github.com/getsentry/craft/pull/662)

### Build / dependencies / internal 🔧

- ci(deps): Upgrade action-prepare-release to latest by @BYK in [#663](https://github.com/getsentry/craft/pull/663)

- ci(release): Add support for auto versioning by @BYK in [#665](https://github.com/getsentry/craft/pull/665)

## 2.14.0

### New Features ✨

- feat(docker): Add support for multiple registries by @BYK in [#657](https://github.com/getsentry/craft/pull/657)

- feat: Add automatic version bumping based on conventional commits by @BYK in [#656](https://github.com/getsentry/craft/pull/656)
- feat: Add `skip-changelog` label by default by @BYK in [#655](https://github.com/getsentry/craft/pull/655)

### Bug Fixes 🐛

- fix(changelog): Unscoped entries should be grouped under "other"  by @BYK in [#659](https://github.com/getsentry/craft/pull/659)

### Build / dependencies / internal 🔧

- ci: Update action-prepare-release to v1.6.5 by @BYK in [#654](https://github.com/getsentry/craft/pull/654)

### Other

-  fix(docker): Support regional Artifact Registry endpoints in isGoogleCloudRegistry by @BYK in [#661](https://github.com/getsentry/craft/pull/661)

## 2.13.1

### Build / dependencies / internal 🔧

- ci: Fix release input desc and concurrency by @BYK in [#653](https://github.com/getsentry/craft/pull/653)

### Bug Fixes 🐛

- fix: Fix startup issue with yargs by @BYK in [#651](https://github.com/getsentry/craft/pull/651)

### Documentation 📚

- docs: Add AGENTS.md by @BYK in [#652](https://github.com/getsentry/craft/pull/652)

## 2.13.0

### New Features ✨

- feat(npm): Add workspaces support by @BYK in [#645](https://github.com/getsentry/craft/pull/645)
- feat(changelog): Add grouping by scope by @BYK in [#644](https://github.com/getsentry/craft/pull/644)
- feat(changelog): Add section ordering by @BYK in [#640](https://github.com/getsentry/craft/pull/640)

### Build / dependencies / internal 🔧

- build(deps): bump jws from 4.0.0 to 4.0.1 by @dependabot in [#650](https://github.com/getsentry/craft/pull/650)

### Bug Fixes 🐛

- fix(changelog): default matcher should match scopes with dashes by @BYK in [#641](https://github.com/getsentry/craft/pull/641)

### Other

- build(deps-dev): bump @octokit/request-error from 6.1.8 to 7.0.0 by @dependabot in [#643](https://github.com/getsentry/craft/pull/643)

## 2.12.1

### Bug Fixes 🐛

- fix: $HOME and some others should be passed in env by @BYK in [#639](https://github.com/getsentry/craft/pull/639)

## 2.12.0

- ref: s/commit_log_patterns/commit_patterns by @BYK in [#638](https://github.com/getsentry/craft/pull/638)
- feat(changelog): Add commit log based categorization by @BYK in [#637](https://github.com/getsentry/craft/pull/637)

## 2.11.2

- fix(publish): Limit env vars for post-release script by @BYK in [#636](https://github.com/getsentry/craft/pull/636)

## 2.11.1

### Bug Fixes 🐛

- fix(npm): Disable scripts during publish by @BYK in [#634](https://github.com/getsentry/craft/pull/634)

## 2.11.0

### Various fixes & improvements

- build(deps): bump parse-path and git-url-parse (#633) by @dependabot
- build(deps): bump glob from 11.0.3 to 13.0.0 (#631) by @dependabot
- build(deps): bump cookie and @sentry/node (#630) by @dependabot
- feat(changelog): Group items by labels, like GitHub (#628) by @BYK
- chore: Upgrade sentry/node to latest (#627) by @BYK
- build(deps): bump js-yaml from 3.13.1 to 4.1.1 (#626) by @dependabot
- build(deps-dev): bump js-yaml from 4.1.0 to 4.1.1 (#624) by @dependabot

## 2.10.1

### Various fixes & improvements

- Fixed argument order in NuGet publish (#622) by @jamescrosswell

## 2.10.0

### Various fixes & improvements

- fix(changelog): escape leading underscores in titles (#620) by @mjq
- fix: Don't fail when there are no releases (#602) by @BYK
- feat: dotnet publish re-entrant (#571) by @bruno-garcia
- chore(maven): Bump retry deadline to 2 hours (#618) by @romtsn
- ref: Log descriptive error message when no tags are found during release preparation (#617) by @Lms24
- feat(aws-lambda): Add description including SDK version to layer metadata (#616) by @msonnb
- build(deps-dev): bump tmp from 0.1.0 to 0.2.4 (#615) by @dependabot

## 2.9.1

### Various fixes & improvements

- fix: Avoid `global.json` when running all `dotnet` commands (#614) by @Flash0ver
- build(deps): bump form-data from 3.0.1 to 3.0.4 (#613) by @dependabot

## 2.9.0

### Various fixes & improvements

- feat(maven): add new config to process klib distributions differently from root and apple (#612) by @buenaflor

## 2.8.0

### Various fixes & improvements

- feat(maven): Add Central repository support (#608) by @romtsn
- build(deps-dev): bump @octokit/request-error from 2.1.0 to 6.1.7 (#588) by @dependabot
- gha: image build needs package write (#607) by @mdtro
- gha: pin action versions to sha and set permissions (#604) by @mdtro

## 2.7.2

### Various fixes & improvements

- chore(maven): Update base url to support publishing to central portal (#605) by @romtsn

## 2.7.1

### Various fixes & improvements

- fix(aws): make reading/writing of aws manifest consistent with other packages (#603) by @sl0thentr0py

## 2.7.0

### Various fixes & improvements

- fix: Avoid global.json when running `dotnet push` (#601) by @jamescrosswell
- feat: support Google ADC for `gcs` artifact provider and target (#600) by @oioki
- docs: Add contribution guidelines (#599) by @BYK
- updated test (#596) by @bitsandfoxes

## 2.6.0

### Various fixes & improvements

- chore: Update CocoaPods from 1.14.2 to 1.16.2 (#594) by @philipphofmann

## 2.5.1

### Various fixes & improvements

- feat: Install most recent Erlang from RabbitMQ packages (#592) by @BYK

## 2.5.0

### Various fixes & improvements

- ref: Bump twine (#593) by @untitaker

## 2.4.2

- No documented changes.

## 2.4.1

### Various fixes & improvements

- fix(): GitHub username not found when pushing to registry (#589) by @Jeffreyhung

## 2.3.8

### Various fixes & improvements

- release: 2.3.7 (621b97be) by @getsentry-bot
- Revert "fix:(GitHub Auth): Deprecate getAuthUsername (#585)" (#590) by @Jeffreyhung

## 2.3.7

### Various fixes & improvements

- Revert "fix:(GitHub Auth): Deprecate getAuthUsername (#585)" (#590) by @Jeffreyhung

## 2.3.5

### Various fixes & improvements

- fix:(GitHub Auth): Deprecate getAuthUsername (#585) by @Jeffreyhung
- build(deps-dev): bump esbuild from 0.24.0 to 0.25.0 (#586) by @dependabot

## 2.3.4

### Various fixes & improvements

- fix(maven): Do not try to publish `.module` file when does not exist (#584) by @romtsn

## 2.3.3

### Various fixes & improvements

- don't make pre-release 'latest' (#583) by @bitsandfoxes

## 2.3.2

### Various fixes & improvements

- remove hardcoded 'previewRelease: false' (#582) by @bitsandfoxes
- fix(github): Fix making github releases latest or not (#536) by @mydea
- fix(github): Guard against missing release (#567) by @mydea

## 2.3.1

### Various fixes & improvements

- fix(aws-lambda): Remove `lambda:ListLayerVersions` permission as it breaks publishing (#580) by @andreiborza

## 2.3.0

### Various fixes & improvements

- feat(aws-lambda): Add `lambda:ListLayerVersions` permission to layer (#579) by @andreiborza
- Replace release bot with GH app (#574) by @Jeffreyhung
- ref: Upgrade Node to v22.12 (#576) by @BYK
- feat: Add rsync to Docker image (#575) by @BYK
- fix(docker): Use proper Erlang binaries for our builds (#577) by @BYK
- remove dotnet 7 (#572) by @bruno-garcia
- chore: Comment why we can't use cocoapods 1.16.2 (#570) by @philipphofmann

## 2.2.1

### Various fixes & improvements

- Rollback CocoaPods from 1.14.2 to 1.16.2 (#569) by @philipphofmann

## 2.2.0

### Various fixes & improvements

- build(deps): bump cross-spawn from 7.0.3 to 7.0.5 (#566) by @dependabot
- Install .NET 9 SDK (#564) by @bruno-garcia
- Bump CocoaPods from 1.14.2 to 1.16.2 (#565) by @philipphofmann
- doc(readme): Add section about release naming conventions (#563) by @Lms24
- test(utils): Add additional tests for version helper functions (#562) by @Lms24

## 2.1.1

### Various fixes & improvements

- fix: Add optional to type chain (#560) by @brian-lou

## 2.1.0

### Various fixes & improvements

- fix(docker): install buildx (#558) by @joshuarli

## 2.0.0

### Various fixes & improvements

- ref(docker): Use docker buildx (BuildKit) to publish docker images (#556) by @Dav1dde
- build(deps): bump micromatch from 4.0.5 to 4.0.8 (#555) by @dependabot
- feat: Add #body-in-changelog option to PR/commit bodies (#554) by @BYK

## 1.22.0

### Various fixes & improvements

- fix(maven): move `importGPGKey` function call from constructor to `publish` (#553) by @buenaflor
- all-repos: update actions/upload-artifact to v4 (#551) by @joshuarli
- build(deps-dev): bump fast-xml-parser from 4.2.5 to 4.4.1 (#550) by @dependabot
- fix(readme): markdown on a long description for skipValidation (#548) by @vaind

## 1.21.0

### Various fixes & improvements

- feat: add skipValidation to dart publishing (#544) by @vaind
- chore: update flutter to the latest version (#545) by @vaind

## 1.20.2

### Various fixes & improvements

- Upgrade Flutter from 3.10.0 to 3.13.0 (#543) by @buenaflor
- build(deps): bump braces from 3.0.2 to 3.0.3 (#542) by @dependabot

## 1.20.1

### Various fixes & improvements

- fix(maven): Rename module.json to dist.module (#540) by @markushi
- fix(maven): ignore artifacts which contain no POM/BOM (#538) by @markushi

## 1.20.0

### Various fixes & improvements

- feat: Publish Gradle module metadata for Maven targets (#535) by @romtsn

## 1.19.1

### Various fixes & improvements

- ref: Rename createdAt to created_at (#534) by @HazAT

## 1.19.0

### Various fixes & improvements

- bump symbol collector 1.17.0 (#533) by @bruno-garcia

## 1.18.0

### Various fixes & improvements

- feat: Add `createdAt` key to json in registry (#532) by @HazAT
- build(deps-dev): bump tar from 4.4.18 to 6.2.1 (#531) by @dependabot

## 1.17.2

- No documented changes.

## 1.17.1

### Various fixes & improvements

- ref: upload to twine synchronously in a single call (#530) by @asottile-sentry

## 1.17.0

### Various fixes & improvements

- ref: upgrade twine to 5.x (#528) by @asottile-sentry

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
