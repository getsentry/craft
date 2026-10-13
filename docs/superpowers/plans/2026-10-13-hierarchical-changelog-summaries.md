# Hierarchical Changelog Summaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Add independently selectable release, category, and scope summaries to PR #902, with bounded bottom-up compression and complete category coverage.

**Architecture:** Build explicit categories and groups during serialization. A bounded reduction engine batches group digests, reuses them for category digests, and generates one release statement per category. Cache raw changelog analysis separately from rendering so automatic version resolution cannot call the model.

**Tech Stack:** TypeScript, Zod, native fetch, OpenRouter structured outputs, Vitest, pnpm.

**Spec:** ../specs/2026-10-13-hierarchical-changelog-summaries-design.md

## Global Constraints

- Native fetch, no additional AI dependencies; opt-in only.
- Maximum 64 requests, concurrency 3, 30 seconds per request, 120-second total deadline, no retries.
- Preserve every original rendered entry, all nested details, and version bump behavior.
- Missing key or failed attempt returns original output; dry runs and PR previews make zero model calls.
- Update PR #902 without merging or changing the example repositories.

## Review Focus

- Unicode oversized entries must be fragmented by serialized UTF-8 bytes without losing text (task 1).
- Duplicate category/scope display names must remain distinct by stable IDs (tasks 1 and 2).
- Missing small/unscoped groups must invalidate category coverage (tasks 1 and 2).
- A failed concurrent request must abort outstanding work and discard all summaries (task 1).
- Version analysis must not poison rendered cache results or summarize twice (task 2).

## Task 1: Bounded hierarchy engine and schema

**Files:** src/utils/ai-summary.ts; src/schemas/project_config.ts; src/utils/__tests__/ai-summary.test.ts; src/__tests__/config.test.ts.

**Interfaces:** SummaryCategory {id,title,groups}; SummaryGroup {id,title,scope?,items}; summarizeChangelog(categories, config) returns {scopes,categories,release} or null. Group/category maps use stable string IDs. Release statements contain category IDs and prose.

- [x] Write failing tests for all seven level selections, hierarchy digest reuse, category coverage, Unicode fragmentation, source-linked critical facts, structural validation, request/deadline limits, and atomic fallback.
- [x] Run `pnpm test src/utils/__tests__/ai-summary.test.ts` and confirm meaningful failures.
- [x] Remove `topLevel`, allow threshold zero, read `CRAFT_AI_API_KEY`, and add validated `levels`, defaulting omitted/empty levels to release; implement bounded request batching and bottom-up reductions with 24,000-byte input batches and at most 8 result nodes per request.
- [x] Prevent generated mentions and references using zero-width separators; test rendered inertness separately with GitHub.
- [x] Run engine and config tests; typecheck after task 2 updates its consumer.

## Task 2: Tree rendering and AI-free version analysis

**Files:** src/utils/changelog.ts; src/utils/autoVersion.ts; src/utils/__tests__/changelog-generate.test.ts; src/utils/__tests__/autoVersion.test.ts.

**Interfaces:** Use task 1's tree and result. generateChangesetFromGit accepts an optional fourth `summarize` boolean (default true); getChangelogWithBumpType passes false. Raw analysis cache is keyed by Git client, active workspace, and revision. Rendering cache additionally distinguishes summary mode and leftover limit.

- [x] Write failing generator tests for selected levels, nested category/scope details, disabled grouping, unscoped entries, recursive item counts, exact fallback, and version-analysis/render cache separation.
- [x] Run generator and autoVersion tests and confirm failures.
- [x] Build category/group IDs and rendering ranges while producing existing entries; fold requested levels after the complete engine succeeds. Emit labeled release statements using original category names.
- [x] Cache raw generation separately and suppress AI during auto-version analysis. Verify normal prepare calls the model only for the actual changelog.
- [x] Run `pnpm test src/utils/__tests__/ai-summary.test.ts src/utils/__tests__/changelog-generate.test.ts src/utils/__tests__/autoVersion.test.ts src/__tests__/config.test.ts`.

## Task 3: Documentation, E2E, and PR delivery

**Files:** README.md; docs/src/content/docs/configuration.md; temporary sample harnesses outside the repository.

- [x] Document all levels, display thresholds versus internal compression, nested rendering, release coverage, and increased request/time bounds.
- [x] Run typecheck, lint, build, and full tests. Name any pre-existing macOS failures.
- [x] Run isolated CLI E2E including no-changelog, dry run, fallback, and preview; render generated hostile prose and nested details through GitHub's Markdown API.
- [ ] Regenerate live previews for Sentry 26.9.0, Toolkit cli@0.47.0, CLI 0.45.0, and Python 2.72.0; verify category coverage, critical facts, original entry preservation, and request budgets.
- [ ] Perform fresh independent code review, address actionable findings, commit/push, update PR description, and verify new-head CI. Do not merge.

Execution is authorized by the user's approval of the design and instruction to implement it in PR #902. Implement natively in this chat, with an independent review at the end.

## Execution record

- Task 1: tests observed failing against the flat engine, then passing with selectable levels, complete batches, Unicode fragmentation, atomic fallback, and budgets.
- Task 2: generator tests observed failing before tree integration, then passing for all seven level combinations, nested details, exact entry preservation, and AI-free version analysis.
- User revision: removed the release-mode switch, normalized omitted/empty levels to release-only, allowed threshold zero, and renamed runtime credentials to CRAFT_AI_API_KEY. Regression tests passed.
- Independent review: one Important finding; distinct critical facts from oversized entry fragments collided on their source ID. Reproduction failed by losing the early CVE fact; fragment-specific fact IDs fixed it, and the regression passed. No Critical or Minor findings; no declined behaviors.
- Validation: 206 targeted tests pass; typecheck, lint, build, and GitHub Markdown rendering pass. Ten isolated CLI E2Es pass. Full macOS suite: 1,344 pass, one skip, and three unchanged baseline failures (Bash associative arrays, temporary-path snapshot, BSD sed). A subsequent added concurrency test also passes.
- Live public release-note replays: all four repositories succeeded, including the complete 1,617-entry Sentry release. Release-only previews preserve expanded originals and category coverage. One Sentry provider attempt fell back atomically before a successful repeat.
- Delivery: pending commit, push, and new-head hosted CI. No merge.

### Copilot provider revision

- User authorized replacing the default Actions OpenRouter path with official Copilot SDK authentication. OpenRouter is explicitly selected and keeps CRAFT_AI_API_KEY; no provider failover.
- SDK 1.0.21 APIs and bundled native runtime verified against installed source and GitHub installation-token docs. Actions pass the built-in token in COPILOT_GITHUB_TOKEN; callers grant copilot-requests: write. Organization billing policy and Luna model availability remain external requirements.
- Action installs a pinned physical SDK tree; Linux/macOS/Windows runtime checks and a manual-only isolated live CLI sample are included. No organization policy changes or merge authorized.
- Fresh independent review identified a late-start cancellation race. Initialization now repeats shutdown after startup resolves during cancellation; the regression passes. No outstanding high/medium findings.
- Local validation: 220 targeted tests, 21 workflow tests, typecheck and lint pass; bundled runtime starts on macOS arm64. Full suite: 1,359 pass, one skipped, and the same three platform baseline failures. Built-CLI sample with mocked SDK passes; this is not live Copilot proof.
- Hosted new-head checks and authenticated Actions inference remain pending delivery.
