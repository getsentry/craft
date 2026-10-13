# Configurable hierarchical changelog summaries

PR: https://github.com/getsentry/craft/pull/902

## Intent

Let repositories choose summaries at any combination of three changelog levels:

1. `release`: overview of the entire release.
2. `category`: New Features, Bug Fixes, Documentation, Internal Changes, Other.
3. `scope`: a rendered subgroup such as New Features / API or Bug Fixes / CLI.

The user asked for configurable combinations and for lower-level summaries to
feed higher-level generation, reducing context and token use. Real-release
previews exposed two problems: Sentry 26.9.0 exceeds the existing single-request
limit; CLI and Python overviews omit changes from smaller groups. Address both
while preserving every original rendered entry and version-bump behavior.

## Configuration

```yaml
changelog:
  policy: auto
  aiSummary:
    enabled: true
    provider: copilot
    model: gpt-6-luna
    levels: [release, category] # any nonempty subset of release/category/scope
    kickInThreshold: 5
```

The user's final configuration requirements supersede earlier defaults:
`levels` defaults to `[release]`, both when omitted and when empty. Reject unknown
or duplicate names. Remove `topLevel`; `levels`, `kickInThreshold`, and `enabled`
fully determine generation and display. `enabled: false` disables all AI work.
`kickInThreshold` defaults to 5 and accepts 0, summarizing every nonempty selected
group. Excluding release omits its overview while preserving other selected levels.

Category and scope display summaries when their recursive original-entry count
exceeds `kickInThreshold`. Release threshold uses the entire rendered release
entry count. Release-only output leaves all original entries expanded. Internal compression is independent of display eligibility:
small groups still contribute to parent generation. With scope grouping
disabled, no artificial scope headings or visible scope summaries are created.
Unscoped entries participate in their category through an internal leaf group.

Existing workspace inheritance rules still apply to the whole changelog object.

## Generation and coverage

Build an explicit category/scope/entry tree while serializing the changelog,
with stable IDs and original-entry counts. Do not infer hierarchy by splitting
display titles or reparsing serialized Markdown in production.

Generate bottom-up only as far as needed for the selected display levels.
Lower-level digests may be generated internally even if that level is hidden.
Do not call the model for display-ineligible groups unless a parent needs them.

For large input, partition all original entries into bounded requests. Split an
individual oversized entry into identified fragments without silently dropping
content. Reduce fragment and batch digests as needed before scope, category,
and release generation. Carry IDs and original counts through every reduction.

Parent input includes every child, including small and unscoped groups. Reuse
the already generated digest instead of sending the same original entries
again. Each structured response must return precisely the requested IDs;
missing, duplicate, or unknown IDs invalidate the attempt.

Engineering choice: make the release overview a short labeled statement per
category. The response contains one statement for every nonempty category,
validated by ID, and Craft supplies the category labels from the original tree.
This provides visible category coverage instead of trusting one free-form
paragraph to mention every category. Preserve important breaking-change and
security facts through reductions, with source IDs; forbid unsupported claims
that no breaking changes or security fixes exist. Structural validation cannot
prove factual accuracy, so live samples remain part of validation.

## Rendering

Release overview appears above the first category and leaves category headings
visible. Category summary appears below its heading, followed by an expandable
block containing that category's original scope headings and entries. A scope
summary similarly precedes an expandable block of its original entries.

When category and scope are both selected, scope summaries and entry blocks
are inside the category's expandable block. Category blocks use recursive
original-entry counts. Avoid duplicating a category summary as a scope summary
when there is no actual scope heading. Each original entry occurs once in the
output, retaining nested details, author attribution, and links. Failed attempts
return the exact original changelog rather than partially folded output.

## Bounds and failure behavior

Engineering choices: at most 64 requests per changelog, at most 3 concurrent
requests, 30 seconds per request, and a 120-second total deadline. Budget each
request by serialized UTF-8 input bytes and expected structured output size;
use conservative smaller batches than the old 120,000-character limit.
Exact batch size is left to implementation and real-release validation.

Provider revision: Copilot is the default, using the official SDK bundled runtime
and installation-token authentication via COPILOT_GITHUB_TOKEN. Actions require
copilot-requests: write and the organization billing policy. GPT-6 Luna is used
only when available; no alternate provider is selected after failure. OpenRouter
remains explicit and reads CRAFT_AI_API_KEY. Workflow secrets map to environment
variables; organization secrets need access to the workflow repository.

No retries. Missing credentials, budget exhaustion, refusal, provider failure,
timeout, or invalid output preserve the original changelog. Abort outstanding
requests on failure or total deadline. Keep generic diagnostics that do not
expose credentials, source changelog data, or raw provider errors. Continue
using provider adapters, strict structured outputs, and dry-run wrappers.

## Related review fixes

Separate version-bump analysis from AI rendering so `prepare auto
--no-changelog` makes zero model calls and ordinary prepare does not summarize
twice. Cache raw GitHub/commit data independently of render options and account
for Git client/revision identity in new cache decisions.

Make generated prose inert in GitHub's actual renderer, including user/team
mentions and issue/PR references. Preserve intentional original author links.
All dry runs and highlighted PR previews continue making zero model calls.

## Validation and delivery

Write failing regression tests before implementation. Cover all seven level
combinations, thresholds, disabled grouping, unscoped groups, single-scope
categories, nested rendering, ID validation, missing groups, oversized inputs
and entries, parent digest reuse, critical facts, deadline and request budgets,
fallback, dry runs, previews, and no-changelog version resolution.

Run relevant tests, typecheck, lint, build, and the full suite. Report the
existing macOS full-suite failures separately if they persist. Validate nested
details and inert prose with GitHub's read-only Markdown API.

Repeat the isolated CLI E2E and live Luna previews using the already authorized
temporary testing credential, if it remains valid. Reuse the fetched public
release fixtures for Sentry 26.9.0, Toolkit cli@0.47.0, CLI 0.45.0, and Python
2.72.0. Check that large Sentry notes summarize, all source entries remain, and
overviews visibly cover every category and its notable changes. These release
note replays are distinct from full repository release runs.

Update PR #902's documentation, tests, title/body as needed, commit and push,
then perform a fresh review and wait for checks on the new head. Do not merge.
Do not change the four example repositories or publish their releases.
