# Craft native installation and updates

## Requested outcome

Add two draft PRs after the existing binary, release, and Homebrew drafts: a curl-based installer, then a built-in updater. Keep npm supported and preserve macOS, Windows, and Linux compatibility.

## Installer

Use a Bash installer, following Sentry CLI's existing Bash entry point, for macOS and Linux x64/arm64 and Windows x64 through Git Bash. Git remains a required external tool. Serve the script at `https://craft.sentry.dev/install` through the existing docs publication pipeline and include it as a release asset.

Default to the latest stable GitHub release. Allow an explicitly selected release version and installation directory. Follow Sentry's directory selection: explicit `CRAFT_INSTALL_DIR`, absolute `XDG_BIN_HOME`, an existing `~/.local/bin` or `~/bin` on PATH, then `~/.local/bin`. Use `craft.exe` on Windows. Print PATH instructions when necessary; do not edit shell profiles or invoke sudo. This installation policy is a builder choice.

Resolve a single release tag before downloading its platform archive and matching SHA-256 sidecar. Validate platform and version inputs, verify the compressed/downloaded bytes before decompression or execution, and check the candidate's version before replacing an existing installation. Like Sentry, delegate placement to the downloaded native executable through `craft setup --install`. The native installer rejects symlink destinations, stages inside the installation directory, serializes installation with a directory lock, and cleans up only files created by the current invocation. Windows replacement retains the running old executable until it can be removed. Failures preserve the previous working installation. Support a dry run with no filesystem changes.

Source comparison: `getsentry/cli` now points to `getsentry/toolkit`. The installer and `packages/cli/src/lib/binary.ts` were verified against upstream commit `a6426b96ba2383893f6fffc0fb758f371e04e566`; local file blob hashes match upstream. Craft uses the same Bash bootstrap/native-placement shape, XDG directory preference, platform naming, serialization, and Unix/Windows replacement approach. Craft-specific adaptations are its release names/checksum sidecars, existing dry-run APIs, and package-manager instructions instead of invoking another package manager.

## Updater

Add `craft update [VERSION]` for standalone Fossilize binaries. Default to the latest stable release. Explicit versions can select prereleases; downgrades and reinstalling the same version require `--force`. Add `--check` for checking availability, and respect the global `--dry-run` without staging files or replacing the executable.

Use public GitHub release metadata and the same asset/checksum contract as the installer. No GitHub token is required. Never forward authentication to asset download redirects. Bound download size and time, verify checksum and candidate version, and verify macOS signatures before executing the candidate.

Replace the actual running native executable, using atomic rename on Unix and old/new rename with rollback on Windows, following Sentry CLI's existing replacement pattern. Use the same installation-directory lock as the installer. A failed download, checksum, version check, permission check, or rename must leave the previous working executable available. Surface errors and retained Windows backup paths clearly.

For npm/JavaScript or Homebrew installations, provide package-manager upgrade instructions instead of replacing managed files. Do not add automatic background checks or updates. These package-manager and manual-update policies are builder choices.

## Verification

Installer tests exercise platform selection, requested/latest versions, checksums, malformed inputs, unsupported hosts, paths containing spaces, dry run, existing destinations, and failure preservation with isolated download fixtures.

Updater tests cover release selection, missing assets, checksum/version mismatch, limits, lock contention, package-manager handling, dry run, and failed replacement rollback. All writes use Craft's existing dry-run abstractions.

Keep existing native/npm verification for all five platforms. Add installer verification against the actual downloaded artifacts. Exercise updating a copied, running standalone executable on each platform, using a test preload to route GitHub fetches to an isolated local fixture; ship no alternate download-source setting in product code. Validate the replaced executable after the updater process exits. No tests publish a release, edit the public tap, or contact live release endpoints.
