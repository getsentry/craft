# Craft: now challenging changesets and more

I've [written about the secure release infrastructure before](https://vanguard.getsentry.net/p/cmihvx6b80000isk7akkwm6s8), but this post is about something different: momentum.

After being in a somewhat dormant state for a while, Craft has been getting a lot of love lately. And I mean _a lot_. Since version 2.12.0 (just about a month ago), we've shipped a flurry of releases with some pretty exciting features. Let me walk you through what's new and why I'm excited about it.

## Automatic Version Bumping 🎯

Remember the days when you had to manually decide if your release was a patch, minor, or major bump? Those days are over. Just run `craft prepare auto` and Craft analyzes your commit messages (conventional commits style) to figure out the version bump for you. If you've got a `feat:` in there, it knows it's a minor bump. A `fix:`? That's a patch. It's like having a tiny version manager living in your commits[^1].

But wait, there's more flexibility here. You can also use explicit bump types:

```bash
craft prepare auto   # Let Craft figure it out from commits
craft prepare patch  # Force a patch bump
craft prepare minor  # Force a minor bump
craft prepare major  # Force a major bump
```

And for teams that prefer calendar-based versioning, Craft now supports `calver` natively:

```yaml
versioning:
  policy: calver
  calver:
    format: "%y.%-m"  # e.g., 24.12 for December 2024
```

The best part? When using auto-versioning, you get a preview in your PR with a "Semver Impact of This PR" section so you know exactly what _your specific change_ will do to the version.

## Beautiful Changelogs 🪷

Craft now groups your changes both by main categories (like Bug Fixes and New Features) _and_ by scope within those categories. The result is a clean, organized changelog that's actually pleasant to read:

```markdown
### New Features ✨

#### Api

- Add user endpoint by @alice in #1
- Add auth endpoint by @bob in #2

#### Core

- Improve performance by @charlie in #3
- General improvement by @dave in #4
```

Those pesky `feat:` and `fix(scope):` prefixes? Stripped automatically. Categories appear in the order you define them. You can even override entries directly in your PR description using a `## Changelog Entry` section.

### The `craft changelog` Command

Want to see what the changelog will look like before you release? Now you can:

```bash
craft changelog              # Preview the upcoming changelog
craft changelog --pr 123     # See how a specific PR will appear
craft changelog --since v2.0 # Generate changelog since a specific tag
```

### Changelog Previews Everywhere

This same changelog preview now shows up automatically in your PRs _and_ in publish issues. Here's what it looks like in a publish issue:

[IMAGE: changelog-preview-publish-issue.png]

Contributors can see exactly how their changes will appear in the final changelog, and release managers get a clear overview of what's shipping.

### Smart Revert Handling

And here's a fun one: **revert handling**. When you revert a commit, Craft now understands that. If both the original and the revert are in the same release, they cancel each other out - neither appears in the changelog nor affects the version bump. If the revert is standalone (the original was in a previous release), it shows up under Bug Fixes with a patch bump. It's almost like Craft understands regret[^2]. We even handle those delightful chains of `Revert "Revert "Revert "..."` correctly. Because of course, we do that.

## GitHub Actions: All-in-One 🔧

Speaking of previews in PRs and issues - you might be wondering how that happens. We've merged the separate `action-prepare-release` repository directly into Craft. Why? Because the action was tightly coupled to Craft anyway, and maintaining them separately was creating more friction than it solved.

This means you now get:

1. **Reusable workflows** - Just call them from your repo, no boilerplate needed:

```yaml
# .github/workflows/release.yml
jobs:
  release:
    uses: getsentry/craft/.github/workflows/release.yml@v2
    with:
      version: ${{ inputs.version || 'auto' }}
    secrets: inherit
```

```yaml
# .github/workflows/changelog-preview.yml
jobs:
  preview:
    uses: getsentry/craft/.github/workflows/changelog-preview.yml@v2
    secrets: inherit
```

2. **Proper outputs** - Get the resolved version, branch, SHA, and changelog back to use in subsequent steps
3. **Dogfooding** - Craft now uses the latest code on master to release itself. We eat our own dog food here.

For more flexibility, you can also use the composite action directly when you need custom pre/post steps.

## npm Workspaces Support 📦

For those of you maintaining monorepos with multiple packages, Craft now supports npm workspaces natively. This one's a game-changer for repos like sentry-javascript and sentry-wizard.

Previously, sentry-javascript had to maintain a [manually curated list of 40+ npm targets](https://github.com/getsentry/sentry-javascript/blob/develop/.craft.yml) in dependency order. And that order? It was [actually incorrect](https://github.com/getsentry/sentry-javascript/pull/18429) in some places. Here's what it looked like:

```yaml
targets:
  # NPM Targets - 40+ manually curated entries in dependency order
  - name: npm
    id: '@sentry/core'
    includeNames: /^sentry-core-\d.*\.tgz$/
  - name: npm
    id: '@sentry/types'
    includeNames: /^sentry-types-\d.*\.tgz$/
  - name: npm
    id: '@sentry/node-core'
    includeNames: /^sentry-node-core-\d.*\.tgz$/
  # ... 35+ more entries ...
  - name: npm
    id: '@sentry/react-router'
    includeNames: /^sentry-react-router-\d.*\.tgz$/
```

Now? Just this:

```yaml
targets:
  - name: npm
    workspaces: true
    excludeWorkspaces: /^@sentry-internal\//
```

That's a ~200 line reduction in config, with automatic dependency ordering. Craft reads your `package.json` workspaces config, figures out the dependency graph, and publishes in the correct order.

We're hoping to expand this feature to other targets like [dotnet/nuget](https://github.com/getsentry/craft/issues/649) in the future.

## Docker Multi-Registry Support 🐳

Pushing your Docker images to multiple registries? Craft now supports that out of the box. Google Artifact Registry, Docker Hub, GitHub Container Registry - push to all of them in a single `craft publish`. We even added support for regional Artifact Registry endpoints because, of course, Google had to make that complicated.

## And More Quality of Life Improvements ✨

We've also shipped a bunch of other improvements you've asked for, like AWS Lambda layer name templating (so you don't have to manually update layer names on major version bumps), regional Artifact Registry endpoint support, and various bug fixes.

Under the hood, we've modernized the toolchain (ESLint 9, Vitest 3, Zod for schema validation) to make contributing to Craft faster and easier[^3].

## New Documentation 📚

Now you might be thinking: "How am I going to remember how to use all this awesome new stuff?" Glad you asked!

We used to ~~shove~~ put everything in the README until recently, but Craft has grown into something much larger than its humble beginnings. All these new features made the need for a dedicated docs site even more urgent. So without further ado:

[IMAGE: craft-docs-site.png]

**[getsentry.github.io/craft](https://getsentry.github.io/craft/)** - configuration reference, target documentation, GitHub Actions guides, and more. It's all there.

## Why This Matters Beyond Sentry

When we first built the release infrastructure at Sentry, it was very much _for_ Sentry. But over time, Craft has evolved into something more general. It's a release management tool that doesn't care if you're shipping npm packages, PyPI wheels, Docker images, Crates, Hex packages, or AWS Lambda layers. It just works. It also nailed the fundamental release flow from the get go: prepare and then publish.

### How Does Craft Compare to Changesets?

If you've used [changesets](https://github.com/changesets/action), you might wonder how Craft differs. The main philosophical difference is that Craft doesn't require you to commit changelog-related files into your repo. With changesets, you need to:

1. Create a changeset file for each PR (an extra step to remember)
2. Manually specify the semver bump type in that file
3. Commit these temporary files to your repo
4. Remove them during release, creating churn

With Craft, all that information lives where it naturally belongs: in your PR titles, descriptions, and labels. No extra files, no extra steps, no repo churn. The changelog is generated automatically from information that's already there.

### Beyond Sentry

With features like automatic versioning, intelligent changelog generation, revert handling, and proper GitHub Actions integration, Craft is becoming a solid option for anyone who wants a consistent, sound, and low-friction release process. And yes, that includes teams outside Sentry.

Looking ahead, we want to make Craft even more accessible to the broader community. That means splitting the omnibus Docker image, and making the built-in targets more modular, so you can customize Craft for your specific needs without forking the whole thing.

## Thank You 🙌

None of this would have happened without the contributions and feedback from you Sentaurs. Special thanks to:

- **Miguel** (@betegon) - for code reviews, ideas, motivation
- **Aditya** (@MathurAditya724) - for code reviews, ideas, motivation
- **Ivana** (@sentrivana) - for code reviews, issues, and being an early adopter
- **Hubert** (@hubertdeng123) - for code reviews and support
- **Andrei** (@andreiborza) - for all things AWS Lambda
- **Daniel Szoke** (@Lms24) - for code contributions, documentation, and code reviews
- **Stefan Pölz** (@Flash0ver) - for dotnet fixes and code reviews

Special thanks to **Stephanie** for organizing the brownbag session in Vienna about Craft - that session was vital in getting everyone engaged and collecting valuable feedback. And to everyone who attended and shared their thoughts: your input shaped many of these improvements.

## Feedback Welcome! 🙏

Here's the thing™: I'm genuinely excited about where Craft is heading, and I'm eager to make it better. If you've got issues - old ones, new ones, feature requests, or just complaints about that one thing that's been bugging you for years - I want to hear about them.

Drop me a message, file an issue, or just leave a comment. I'm actively working on Craft and happy to tackle whatever comes up. This is the kind of infrastructure work that quietly makes everyone's life better, and I'm here for it.

LFG 🚀

[^1]: It's not actually living there. That would be creepy. It just reads the messages. Still creepy? OK moving on.
[^2]: It doesn't. But it handles reverts correctly, which is almost the same thing in software.
[^3]: The Vitest migration alone touches ~30 test files. Don't ask me how I know this.
