# Native installer and updater implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a Sentry-style installer and native updater in two stacked draft PRs.

**Architecture:** Bash downloads and verifies the platform asset, then delegates installation to `craft setup --install`. A shared TypeScript filesystem helper serializes placement and handles Unix atomic replacement and Windows rollback. `craft update [VERSION]` verifies release metadata and bytes before using that helper.

**Tech Stack:** Existing TypeScript/yargs/Vitest, Bash, Node filesystem/crypto/fetch/zlib, existing dry-run wrappers; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-14-native-install-update-design.md`

## Global Constraints

- Keep both PRs drafts; do not publish releases or edit the live tap.
- Support macOS/Linux x64/arm64 and Windows x64; use Git Bash for the Windows bootstrap.
- Preserve npm/legacy JS; default latest to stable; no profile edits or sudo.
- Verify checksum and version before replacement; respect dry-run; preserve the old executable on failures.
- All product mutations use Craft's dry-run abstractions; package management uses pnpm.

## Review Focus

- Hostile/malformed version or checksum input must never execute unverified bytes.
- Redirects/download failures and oversized bodies must preserve the current installation.
- Existing symlinks, concurrent installations, and paths containing spaces must be safe.
- Windows running executable replacement and rollback must work on the real runner.
- npm/Homebrew installs and dry runs must never overwrite managed binaries or write staging files.

---

### Task 1: Bootstrap and native placement (installer draft)

**Files:** `install`, `src/utils/nativeInstallation.ts`, `src/commands/setup.ts`, `src/index.ts`, `src/__tests__/native-installation.test.ts`, `src/__tests__/install-script.test.ts`, `.github/scripts/installer-smoke.mjs`, both build workflows, `.craft.yml`, `docs/copy-installer.mjs`, `docs/package.json`, `.gitignore`, getting-started docs.

**Interfaces:** Produce `getNativeFilename(platform, arch)`, `getInstallDirectory(env, home)`, and `installNativeBinary(source, destination, platform): Promise<{ path: string; backup?: string }>` for Task 2. Placement uses an exclusive `.craft-install.lock` directory, a unique sibling stage, and a unique Windows backup; rollback restores the original if the second rename fails. Bootstrap options: `--version`, `--install-dir`, `--dry-run`, `--help`; matching CRAFT environment overrides.

- [ ] Write and run failing tests for placement, symlink rejection, lock contention, dry-run, Windows rollback, directory preference, and platform rejection.
- [ ] Implement shared placement helper and native-only `setup --install`; register the command.
- [ ] Write and run failing bootstrap tests using isolated curl/uname stubs: pinned/latest version, checksum mismatch, malformed input, dry-run, download failure, and directory spaces.
- [ ] Implement the Bash bootstrap and static website/release-asset copying (`craft-install` asset; `/install` website path).
- [ ] Add real artifact bootstrap verification to all five platform jobs with isolated download stubs; preserve existing native/npm smoke.
- [ ] Run focused tests, lint, typecheck, formatting, docs build, and real local native/bootstrap smoke. Expected: passing new tests and runnable shipped artifacts.
- [ ] Commit, independently review, push and create/attach a draft PR stacked on #905. Record validation and any rulings.

### Task 2: Native updater (updater draft)

**Files:** `src/utils/nativeUpdate.ts`, `src/commands/update.ts`, `src/index.ts`, `src/__tests__/native-update.test.ts`, `.github/scripts/updater-smoke.mjs`, both build workflows, getting-started docs.

**Interfaces:** Consume Task 1 placement helper. Produce `resolveNativeRelease(version?, platform?, arch?)` and `updateNativeBinary(options)` using the real running executable. Fetch from public GitHub metadata, validate exact Craft release asset URLs, cap metadata/checksum/binary bodies, and verify SHA-256, decompression limit, signature and version before placement. Native command: `update [VERSION]`, `--check`, `--force`, global dry-run.

- [ ] Write/run failing release and update tests for stable/pinned selection, missing assets, bad checksums/versions, size/time limits, managed installs, dry-run, same-version/downgrade guards, and failed installation.
- [ ] Implement updater and command using existing wrappers; no alternate production download-source option.
- [ ] Add actual running-native self-update verification on each runner using a test preload and local HTTP fixtures; verify replacement and failure preservation after process exit.
- [ ] Run focused/full relevant validation and native tests. Expected: verified update and rollback on macOS, Linux and Windows; npm remains unchanged.
- [ ] Commit, independently review, push and create/attach a draft PR stacked on the installer draft. Verify exact-head CI, update both descriptions, and keep all five PRs drafts.
