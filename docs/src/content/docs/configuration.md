---
title: Configuration
description: Complete reference for .craft.yml configuration
---

Project configuration for Craft is stored in `.craft.yml` in the project root.

## GitHub Project

Craft tries to determine GitHub repo information from the local git repo. You can also hard-code it:

```yaml
github:
  owner: getsentry
  repo: sentry-javascript
```

## Pre-release Command

This command runs on your release branch as part of `craft prepare`. Default: `bash scripts/bump-version.sh`.

```yaml
preReleaseCommand: bash scripts/bump-version.sh
```

The command is executed with the following environment variables:

- `CRAFT_OLD_VERSION`: The previous version (or `0.0.0` if no previous version exists)
- `CRAFT_NEW_VERSION`: The new version being released

The script should:

- Use these environment variables to perform version replacement
- Replace version occurrences
- Not commit changes
- Not change git state

> **Note:** For backward compatibility, the old and new versions are also passed as the last two command-line arguments to the script, but using environment variables is safer and recommended.

Example script:

```bash
#!/bin/bash
set -eux

# Use CRAFT_NEW_VERSION provided by craft
export npm_config_git_tag_version=false
npm version "${CRAFT_NEW_VERSION}"
```

## Automatic Version Bumping

When `minVersion: "2.21.0"` or higher is set and no custom `preReleaseCommand` is defined, Craft automatically bumps version numbers based on your configured publish targets. This eliminates the need for a `scripts/bump-version.sh` script in most cases.

### How It Works

1. Craft examines your configured `targets` in `.craft.yml`
2. For each target that supports version bumping, Craft updates the appropriate project files
3. Targets are processed in the order they appear in your configuration
4. Each target type is only processed once (e.g., multiple npm targets won't bump `package.json` twice)

### Supported Targets

| Target    | Detection               | Version Bump Method                                         |
| --------- | ----------------------- | ----------------------------------------------------------- |
| `npm`     | `package.json` exists   | `npm version --no-git-tag-version` (with workspace support) |
| `pypi`    | `pyproject.toml` exists | hatch, poetry, setuptools-scm, or direct edit               |
| `crates`  | `Cargo.toml` exists     | `cargo set-version` (requires cargo-edit)                   |
| `gem`     | `*.gemspec` exists      | Direct edit of gemspec and `lib/**/version.rb`              |
| `pub-dev` | `pubspec.yaml` exists   | Direct edit of pubspec.yaml                                 |
| `hex`     | `mix.exs` exists        | Direct edit of mix.exs                                      |
| `nuget`   | `*.csproj` exists       | dotnet-setversion or direct XML edit                        |

### npm Workspace Support

For npm/yarn/pnpm monorepos, Craft automatically detects and bumps versions in all workspace packages:

- **npm 7+**: Uses `npm version --workspaces` to bump all packages at once
- **yarn/pnpm or npm < 7**: Falls back to bumping each non-private package individually

Workspace detection checks for:

- `workspaces` field in root `package.json` (npm/yarn)
- `pnpm-workspace.yaml` (pnpm)

Private packages (`"private": true`) are skipped during workspace version bumping.

### Python (pypi) Detection Priority

For Python projects, Craft detects the build tool and uses the appropriate method:

1. **Hatch** - If `[tool.hatch]` section exists → `hatch version <version>`
2. **Poetry** - If `[tool.poetry]` section exists → `poetry version <version>`
3. **setuptools-scm** - If `[tool.setuptools_scm]` section exists → No-op (version derived from git tags)
4. **Direct edit** - If `[project]` section with `version` field exists → Edit `pyproject.toml` directly

### Enabling Automatic Version Bumping

To enable automatic version bumping, ensure your `.craft.yml` has:

```yaml
minVersion: '2.21.0'
targets:
  - name: npm # or pypi, crates, etc.
  # ... other targets
```

And either:

- Remove any custom `preReleaseCommand`, or
- Don't define `preReleaseCommand` at all

### Disabling Automatic Version Bumping

To disable automatic version bumping while still using minVersion 2.21.0+:

```yaml
minVersion: '2.21.0'
preReleaseCommand: '' # Explicitly set to empty string
```

Or define a custom script:

```yaml
minVersion: '2.21.0'
preReleaseCommand: bash scripts/my-custom-bump.sh
```

### Error Handling

If automatic version bumping fails:

- **Missing tool**: Craft reports which tool is missing (e.g., "Cannot find 'npm' for version bumping")
- **Command failure**: Craft shows the error from the failed command
- **No supported targets**: Craft warns that no targets support automatic bumping

In all error cases, Craft suggests defining a custom `preReleaseCommand` as a fallback.

### Recovery from Failed Prepare

If version bumping succeeds but `craft prepare` fails mid-way (e.g., during changelog generation or git operations), you may need to clean up manually:

1. **Check the release branch**: If a release branch was created, you can delete it:

   ```bash
   git branch -D release/<version>
   ```

2. **Revert version changes**: If files were modified but not committed, reset them:

   ```bash
   git checkout -- package.json pyproject.toml Cargo.toml  # or whichever files were changed
   ```

3. **Re-run prepare**: Once the issue is fixed, run `craft prepare` again. Version bumping is idempotent—running it multiple times with the same version is safe.

:::tip
Use `craft prepare --dry-run` first to preview what changes will be made without modifying any files.
:::

## Post-release Command

This command runs after a successful `craft publish`. Default: `bash scripts/post-release.sh`.

```yaml
postReleaseCommand: bash scripts/post-release.sh
```

## Release Branch Name

Override the release branch prefix. Default: `release`.

```yaml
releaseBranchPrefix: publish
```

Full branch name: `{releaseBranchPrefix}/{version}`

The prefix may contain slashes, which is useful for monorepos that release
several independently-versioned products from one repository. Pairing a slashed
`releaseBranchPrefix` with a per-product `github.tagPrefix` keeps each product's
release branches and tags separate:

```yaml
releaseBranchPrefix: release/cli
targets:
  - name: github
    tagPrefix: "cli@"
```

This produces branches like `release/cli/1.2.3` and tags like `cli@1.2.3`. See
the [GitHub target docs](./targets/github/#monorepo-independently-versioned-products)
for the full monorepo pattern.

## Changelog Policies

Craft supports `simple` and `auto` changelog management modes.

### Simple Mode

Reminds you to add a changelog entry:

```yaml
changelog: CHANGES
```

Or with options:

```yaml
changelog:
  filePath: CHANGES.md
  policy: simple
```

### Auto Mode

Automatically generates changelog from commits:

```yaml
changelog:
  policy: auto
```

Auto mode uses `.github/release.yml` to categorize PRs. This file follows [GitHub's release.yml format](https://docs.github.com/en/repositories/releasing-projects-on-github/automatically-generated-release-notes#configuring-automatically-generated-release-notes) with Craft-specific extensions.

#### AI summaries

Opt in to configurable changelog summaries. The CLI and Actions use the same HTTP client and connection settings:

```yaml
changelog:
  policy: auto
  aiSummary:
    enabled: true
    levels: [release, category, scope] # choose any combination
    kickInThreshold: 5 # summarize displayed groups with more than 5 entries
    llm:
      endpoint: https://api.githubcopilot.com/responses # default
      model: gpt-6-luna # default
      apiKeyEnv: AI_SUMMARY_TOKEN # default; name of a credential environment variable
```

Craft contains only a shared HTTP summarizer, with no Copilot SDK, native
runtime, bridge, package installer, or separate runtime artifact. Provide a
credential in the selected environment variable; Craft never reads stored
Copilot login or automatically takes a GitHub release token.

| Setting | Default | Behavior |
| --- | --- | --- |
| `enabled` | `false` | Enable summaries explicitly. |
| `llm.endpoint` | `https://api.githubcopilot.com/responses` | Full POST URL. HTTPS required except loopback HTTP. Credentials, fragments, and redirects in URLs are rejected. |
| `llm.model` | `gpt-6-luna` | Model ID at the selected endpoint; access depends on the credential's policy. |
| `llm.apiKeyEnv` | `AI_SUMMARY_TOKEN` | Name of the environment variable containing the credential. Never put a raw secret in configuration or CLI arguments. |
| `levels` | `[release]` | Any combination of `release`, `category`, and `scope`, without duplicates. Omitted or empty lists use `[release]`. Selects visible summaries; internal digests can still be generated for parent summaries. |
| `kickInThreshold` | `5` | Nonnegative integer. Summaries appear only when original entry counts exceed this value. `0` summarizes every nonempty selected group. Category counts include descendants; release counts include the entire changelog. |

The request format is inferred from the URL: endpoints ending in `/responses`
use OpenAI-compatible Responses; other endpoints use Chat Completions. There
is no `api` setting or provider fallback. Both formats must support strict JSON
schema output. Responses uses `store: false`; neither format supplies tools.
The default was verified against Copilot's live catalog: Luna advertises
Responses and structured output, but not Chat Completions. Copilot hosts receive
the integration and API-version headers; custom hosts do not.

The three levels follow the existing changelog hierarchy:

- `release`: a labeled overview statement for every nonempty category.
- `category`: a summary under a heading such as **New Features** or **Bug Fixes**.
- `scope`: a summary under a subgroup such as **New Features → CLI**.

For example, `levels: [release, category]` shows the release overview and
category summaries. `levels: [scope]` summarizes eligible scope lists. With all
three selected, scope summaries and their original entries are nested inside
an expandable category block. Scope summaries require a visible scope heading;
when `scopeGrouping: false`, category and release summaries still work.
Unscoped entries always contribute to their category and the release overview.

The default release-only output adds an overview and leaves all original entries
expanded. Excluding `release` omits the overview while allowing the other selected
levels. `enabled: false` disables all AI generation, including internal digests.

Six CLI entries under **New Features → CLI** with `scope` selected become:

```markdown
#### CLI

Added commands for configuration, deployment, and authentication.

<details>
<summary>Show 6 items</summary>

- Add configuration command by @author in [#101](https://github.com/org/repo/pull/101)
- Add configuration export command
- Add deployment command
- Add deployment status command
- Add login command
- Add logout command

</details>
```

The original entries, nested details, author mentions, and links are preserved
inside the expandable block. Summaries are additional generated prose; review
them before publishing. The optional overview appears above the first category.
Workspace settings follow the normal `changelog` inheritance rules: a workspace
either inherits the whole object or replaces it with its own configuration.

Craft generates digests bottom-up and reuses them for higher levels. Small
and unscoped groups contribute even when they do not qualify for a visible
summary. Large groups are divided into complete bounded batches; oversized
individual entries are split into Unicode-safe fragments. Higher levels use
those digests, reducing repeated context. Breaking changes and security facts
carry their source IDs through reductions and remain visible alongside the
summary prose. Structural validation ensures category coverage; generated
prose still needs human review for factual accuracy.

Existing leftover-entry limits still apply. Enabling summaries sends the
rendered changelog content and original critical PR titles to the selected endpoint.
Billing follows the supplied credential and provider. Large releases and additional levels can require
multiple requests.

Missing credentials, API errors, timeouts, refusals, invalid output, or exhausted
budgets keep the entire original changelog. Craft makes no retries, allows at
most 64 requests with 3 concurrent requests, and waits at most 30 seconds per
request and 120 seconds overall. Each request carries at most 24,000 UTF-8 bytes
of input data and allows at most 8,192 output tokens. Summaries are disabled
during all dry runs, including worktree dry runs, highlighted `craft changelog
--pr` previews, and automatic version analysis. `prepare --no-changelog` makes
no model calls. The calculated version bump is unaffected.

##### CLI connection settings

With summaries enabled, put an authorized Copilot credential in
`AI_SUMMARY_TOKEN` and run `craft changelog --since 1.0.0`. The endpoint and
model can be omitted to use Copilot Responses and GPT-6 Luna. A user-owned
fine-grained PAT needs **Copilot Requests: write** and Copilot access; classic
PATs are not supported. See [GitHub's authentication guide](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/authenticate-copilot-cli).

For a custom endpoint, configure all connection fields together:

```yaml
changelog:
  policy: auto
  aiSummary:
    enabled: true
    llm:
      endpoint: https://gateway.example.com/v1/chat/completions
      model: your-model
      apiKeyEnv: TEAM_MODEL_TOKEN
```

Supply `TEAM_MODEL_TOKEN` securely in the environment. CLI flags
`--ai-endpoint`, `--ai-model`, and `--ai-api-key-env` override their corresponding
`CRAFT_AI_ENDPOINT`, `CRAFT_AI_MODEL`, and `CRAFT_AI_API_KEY_ENV` environment
variables. `CRAFT_AI_LLM` accepts a JSON object with `endpoint`, `model`, and
`apiKeyEnv`. Per-field precedence is CLI flags, structured environment settings,
scalar environment overrides, then the effective `.craft.yml` (including
workspace overrides or `prepare --config-from`). Omitted fields use defaults;
empty or invalid fields are rejected. Missing credentials make no request and
retain the original changelog.

Copilot inference endpoints are a backend HTTP interface rather than GitHub's
public REST API; their contract can change. The default direct Responses call
was live-verified with an authorized user login. That does not prove access for
another user, an organization's workflow token, or a different organization
policy. Craft makes no authentication exchanges, credential discovery, retries,
or silent endpoint switches.

##### GitHub Actions

The Action uses the same CLI resolver and HTTP client. Pass connection settings
as one `llm` JSON object and map an explicit credential to `llm_api_key`:

```yaml
- uses: getsentry/craft@v2
  env:
    GITHUB_TOKEN: ${{ github.token }} # release operations
  with:
    llm: '{"endpoint":"https://gateway.example.com/v1/responses","model":"your-model"}'
    llm_api_key: ${{ secrets.TEAM_MODEL_TOKEN }}
```

`llm` overrides `CRAFT_AI_LLM` in the step environment. For repository or
organization variables, pass `llm: ${{ vars.CRAFT_AI_LLM }}` from the calling
workflow; the reusable release workflow supplies this fallback automatically.
Composite action metadata cannot access the `vars` context directly. Individual connection fields still
follow the shared resolver's precedence. `llm_api_key` maps to
`AI_SUMMARY_TOKEN` and selects that variable over a configured `apiKeyEnv`.
Alternatively, omit `llm_api_key` and map a secret to the configured environment
variable. Craft reads the environment, not GitHub's secret store. The secret
must be available to the repository running the workflow; an organization
secret with selected-repository access can provide shared configuration.

For default Copilot settings, omit `llm` and provide an authorized Copilot
credential via `llm_api_key` or `AI_SUMMARY_TOKEN`. The Action does not
implicitly use `${{ github.token }}`. If choosing an organization workflow
token explicitly, callers must grant `copilot-requests: write` and the
organization must enable **“Allow use of Copilot CLI billed to the organization.”**
Usage in that mode is billed to the organization. Do not assume this policy is
enabled in `getsentry`; the direct workflow-token path requires authorized live
validation. See [GitHub's organization authentication guide](https://docs.github.com/en/copilot/how-tos/copilot-sdk/auth/server-to-server-tokens).
Personal credentials follow their own Copilot access and billing. Custom
provider credentials need no Copilot workflow permission.

Reusable workflows accept the same structured `llm` input and an optional
`llm_api_key` secret:

```yaml
jobs:
  release:
    permissions:
      contents: write
    uses: getsentry/craft/.github/workflows/release.yml@v2
    with:
      llm: '{"endpoint":"https://gateway.example.com/v1/chat/completions","model":"your-model"}'
    secrets:
      llm_api_key: ${{ secrets.TEAM_MODEL_TOKEN }}
```

When using the reusable workflow's secret, omit `apiKeyEnv` to use the standard
mapping. Omit `llm` to use default Copilot settings with the supplied credential.
The workflow cannot increase its caller's token permissions. HTTP failures
keep the original changelog and never select another provider. Ordinary Craft
builds, release assets, nightly artifacts, and npm packages need no Copilot
packages. Linux, macOS, and Windows CI runs isolated CLI and Actions-environment
HTTP fixtures; fixture success is separate from live Copilot proof.

#### Craft Extensions to release.yml

Craft extends GitHub's format with two additional fields:

| Field             | Description                                                               |
| ----------------- | ------------------------------------------------------------------------- |
| `commit_patterns` | Array of regex patterns to match commit/PR titles (in addition to labels) |
| `semver`          | Version bump type for auto-versioning: `major`, `minor`, or `patch`       |

:::caution[Required for Version Detection]
The `semver` field is required for Craft's automatic version detection to work.
If you define a custom `.github/release.yml` without `semver` fields, PRs will
still appear in the changelog but won't contribute to suggested version bumps.
The [changelog preview](/github-actions/#changelog-preview) will show "None" for semver impact.
:::

#### Default Configuration

If `.github/release.yml` doesn't exist, Craft uses these defaults based on [Conventional Commits](https://www.conventionalcommits.org/):

```yaml
changelog:
  exclude:
    labels:
      - skip-changelog
  categories:
    - title: Breaking Changes 🛠
      commit_patterns:
        - "^(?<type>\\w+(?:\\((?<scope>[^)]+)\\))?!:\\s*)"
      semver: major
    - title: Security 🔒
      commit_patterns:
        - "^(?<type>security(?:\\((?<scope>[^)]+)\\))?!?:\\s*)"
      semver: patch
    - title: New Features ✨
      commit_patterns:
        - "^(?<type>feat(?:\\((?<scope>[^)]+)\\))?!?:\\s*)"
      semver: minor
    - title: Bug Fixes 🐛
      commit_patterns:
        - "^(?<type>fix(?:\\((?<scope>[^)]+)\\))?!?:\\s*)"
        - '^Revert "'
      semver: patch
    - title: Documentation 📚
      commit_patterns:
        - "^(?<type>docs?(?:\\((?<scope>[^)]+)\\))?!?:\\s*)"
      semver: patch
    - title: Internal Changes 🔧
      commit_patterns:
        - "^(?<type>(?:build|refactor|meta|chore|ci|ref|perf|tests?|style)(?:\\((?<scope>[^)]+)\\))?!?:\\s*)"
      semver: patch
```

#### Example Configuration

```yaml
changelog:
  categories:
    - title: Features
      labels:
        - enhancement
      commit_patterns:
        - "^(?<type>feat(?:\\((?<scope>[^)]+)\\))?!?:\\s*)"
      semver: minor
    - title: Bug Fixes
      labels:
        - bug
      commit_patterns:
        - "^(?<type>fix(?:\\((?<scope>[^)]+)\\))?!?:\\s*)"
      semver: patch
```

### Custom Changelog Entries from PR Descriptions

By default, the changelog entry for a PR is generated from its title. However,
PR authors can override this by adding a "Changelog Entry" section to the PR
description. This allows for more detailed, user-facing changelog entries without
cluttering the PR title.

To use this feature, add a markdown heading (level 2 or 3) titled "Changelog Entry"
to your PR description, followed by the desired changelog text:

```markdown
### Description

Add `foo` function, and add unit tests to thoroughly check all edge cases.

### Changelog Entry

Add a new function called `foo` which prints "Hello, world!"

### Issues

Closes #123
```

The text under "Changelog Entry" will be used verbatim in the changelog instead
of the PR title. If no such section is present, the PR title is used as usual.

#### Advanced Features

1. **Multiple Entries**: If you use multiple top-level bullet points in the
   "Changelog Entry" section, each bullet will become a separate changelog entry:

   ```markdown
   ### Changelog Entry

   - Add OAuth2 authentication
   - Add two-factor authentication
   - Add session management
   ```

2. **Nested Content**: Indented bullets (4+ spaces or tabs) are preserved as
   nested content under their parent entry:

   ```markdown
   ### Changelog Entry

   - Add authentication system
     - OAuth2 support
     - Two-factor authentication
     - Session management
   ```

   This will generate:

   ```markdown
   - Add authentication system by @user in [#123](url)
     - OAuth2 support
     - Two-factor authentication
     - Session management
   ```

   Note: Nested items do NOT get author/PR attribution - only the top-level entry does.

3. **Plain Text**: If no bullets are used, the entire content is treated as a
   single changelog entry. Multi-line text is automatically joined with spaces
   to ensure valid markdown output.

4. **Content Isolation**: Only content within the "Changelog Entry" section is
   included in the changelog. Other sections (Description, Issues, etc.) are
   ignored.

### Scope Grouping

Changes are automatically grouped by scope (e.g., `feat(api):` groups under "Api"):

```yaml
changelog:
  policy: auto
  scopeGrouping: true # default
```

Scope headers are only shown for scopes with more than one entry. Entries without
a scope are listed at the bottom of each category section without a sub-header.

Example output with scope grouping:

```text
### New Features

#### Api

- Add user endpoint by @alice in [#1](https://github.com/...)
- Add auth endpoint by @bob in [#2](https://github.com/...)

#### Ui

- Add dashboard by @charlie in [#3](https://github.com/...)

- General improvement by @dave in [#4](https://github.com/...)
```

### Workspace-aware changelogs

When you select a Craft release workspace, automatic changelogs include commits
that change files in that workspace and commits that change shared files outside
all workspaces. Commits confined to another workspace are excluded. Craft detects
package ownership from pnpm, npm, or Yarn workspaces as well as the release
workspaces in `.craft.yml`. Commits spanning workspaces appear in each affected
workspace's changelog. This also scopes automatic version detection; single-unit
repositories keep their existing behavior.

If a release includes files from another workspace, add its directory to
`includePaths` on that release unit. Paths are relative to the repository root,
match whole directory names, and cannot escape the repository:

```yaml
workspaces:
  packages/cli:
    changelog:
      policy: auto
      includePaths:
        - apps/cli-docs
```

Most workspaces need no `includePaths` setting.

### Title Stripping (Default Behavior)

By default, conventional commit prefixes are stripped from changelog entries.
The type (e.g., `feat:`) is removed, and the scope is preserved when entries
aren't grouped under a scope header.

This behavior is controlled by named capture groups in `commit_patterns`:

- `(?<type>...)` - The type prefix to strip (includes type, scope, and colon)
- `(?<scope>...)` - Scope to preserve when not under a scope header

| Original Title            | Scope Header | Displayed Title      |
| ------------------------- | ------------ | -------------------- |
| `feat(api): add endpoint` | Yes (Api)    | `Add endpoint`       |
| `feat(api): add endpoint` | No           | `(api) Add endpoint` |
| `feat: add endpoint`      | N/A          | `Add endpoint`       |

To disable stripping, provide custom patterns using non-capturing groups:

```yaml
commit_patterns:
  - "^feat(?:\\([^)]+\\))?!?:" # No named groups = no stripping
```

### Skipping Changelog Entries

You can exclude PRs or commits from the changelog in several ways:

#### Magic Word

Add `#skip-changelog` anywhere in your commit message or PR body:

```
chore: Update dependencies

#skip-changelog
```

#### Skip Label

PRs with the `skip-changelog` label are automatically excluded.

#### Configuration

Configure exclusions in `.github/release.yml`:

```yaml
changelog:
  exclude:
    labels:
      - skip-changelog
      - dependencies
    authors:
      - dependabot[bot]
      - renovate[bot]
```

### Configuration Options

| Option                    | Description                                                                  |
| ------------------------- | ---------------------------------------------------------------------------- |
| `changelog`               | Path to changelog file (string) OR configuration object                      |
| `changelog.filePath`      | Path to changelog file. Defaults to `<workspace>/CHANGELOG.md` for a directory workspace, otherwise `CHANGELOG.md`. Explicit paths take precedence. |
| `changelog.policy`        | Mode: `none`, `simple`, or `auto`. Default: `none`                           |
| `changelog.scopeGrouping` | Enable scope-based grouping. Default: `true`                                 |
| `changelog.includePaths`  | Extra workspace directories to include in automatic changelogs. Default: `[]` |
| `changelog.aiSummary` | Opt-in HTTP release, category, and scope summaries. Default: disabled. |

## Versioning

Configure default versioning behavior:

```yaml
versioning:
  policy: auto # auto, manual, or calver
```

### Versioning Policies

| Policy   | Description                                                                         |
| -------- | ----------------------------------------------------------------------------------- |
| `auto`   | Analyze commits to determine version bump (default when using `craft prepare auto`) |
| `manual` | Require explicit version argument                                                   |
| `calver` | Use calendar-based versioning                                                       |

### Calendar Versioning (CalVer)

For projects using calendar-based versions:

```yaml
versioning:
  policy: calver
  calver:
    format: '%y.%-m' # e.g., 24.12 for December 2024
    offset: 14 # Days to look back for date calculation
```

Format supports:

- `%y` - 2-digit year
- `%m` - Zero-padded month
- `%-m` - Month without padding

## Minimal Version

Require a minimum Craft version:

```yaml
minVersion: '0.5.0'
```

## Required Files

Ensure specific artifacts exist before publishing:

```yaml
requireNames:
  - /^sentry-craft.*\.tgz$/
  - /^gh-pages.zip$/
```

## Status Provider

Configure build status checks:

```yaml
statusProvider:
  name: github
  config:
    contexts:
      - Travis CI - Branch
```

## Artifact Provider

Configure where to fetch artifacts from:

```yaml
artifactProvider:
  name: github # or 'gcs' or 'none'
```

### GitHub Artifact Provider Configuration

By default, the GitHub artifact provider looks for artifacts named exactly as the commit SHA. You can customize this with the `artifacts` configuration option.

#### Pattern Syntax

- **Regex patterns**: Wrapped in `/` (e.g., `/^build-.*$/`)
- **Exact strings**: Plain text (e.g., `build`, `release-artifacts`)

#### Configuration Formats

**1. Single artifact pattern** - searches all workflows:

```yaml
artifactProvider:
  name: github
  config:
    artifacts: /^sentry-.*\.tgz$/
```

**2. Multiple artifact patterns** - searches all workflows:

```yaml
artifactProvider:
  name: github
  config:
    artifacts:
      - /^sentry-.*\.tgz$/
      - release-bundle
```

**3. Workflow-scoped patterns** - filter by workflow name:

```yaml
artifactProvider:
  name: github
  config:
    artifacts:
      build: release-artifacts # exact workflow → exact artifact
      /^build-.*$/: artifacts # workflow pattern → exact artifact
      ci: # exact workflow → multiple artifacts
        - /^output-.*$/
        - bundle
      /^release-.*$/: # workflow pattern → multiple artifacts
        - /^dist-.*$/
        - checksums
```

#### Common Examples

Fetch artifacts named `craft-binary` and `craft-docs` from the "Build & Test" workflow:

```yaml
artifactProvider:
  name: github
  config:
    artifacts:
      Build & Test:
        - craft-binary
        - craft-docs
```

Fetch all `.tgz` files from any workflow:

```yaml
artifactProvider:
  name: github
  config:
    artifacts: /\.tgz$/
```

#### Backward Compatibility

When `artifacts` is not configured, the provider uses the legacy behavior where it searches for an artifact with a name matching the commit SHA exactly. This ensures existing configurations continue to work without changes.

## Targets

List release targets in your configuration:

```yaml
targets:
  - name: npm
  - name: github
  - name: registry
    id: browser
    type: sdk
    onlyIfPresent: /^sentry-browser-.*\.tgz$/
```

See [Target Configurations](./targets/) for details on each target.

### Per-target Options

These options apply to all targets:

| Option         | Description                                         |
| -------------- | --------------------------------------------------- |
| `includeNames` | Regex: only matched files are processed             |
| `excludeNames` | Regex: matched files are skipped                    |
| `id`           | Unique ID for the target (use with `-t target[id]`) |

Example:

```yaml
targets:
  - name: github
    includeNames: /^.*\.exe$/
    excludeNames: /^test.exe$/
```
