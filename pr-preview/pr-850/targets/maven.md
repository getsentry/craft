---
title: "Maven"
description: "Publish packages to Maven Central"
url: "https://craft.sentry.dev/pr-preview/pr-850/targets/maven/"
---

# Maven

PGP signs and publishes packages to Maven Central.

Tip

Set the logging level to `trace` to see command output.

## Configuration

| Option | Description |
| --- | --- |
| `mavenCliPath` | Path to Maven CLI (must be executable) |
| `mavenSettingsPath` | Path to Maven `settings.xml` |
| `mavenRepoId` | Maven server ID in `settings.xml` |
| `mavenRepoUrl` | Maven repository URL |
| `android` | Android configuration object or `false` |
| `kmp` | Kotlin Multiplatform configuration or `false` |

### Android Configuration

| Option | Description |
| --- | --- |
| `distDirRegex` | Pattern for distribution directory names |
| `fileReplaceeRegex` | Pattern for module name substring to replace |
| `fileReplacerStr` | Replacement string for Android distribution file |

### KMP Configuration

| Option | Description |
| --- | --- |
| `rootDistDirRegex` | Pattern for root distribution directory |
| `appleDistDirRegex` | Pattern for Apple platform directories |
| `klibDistDirRegex` | Pattern for JS/WASM directories |

## Environment Variables

| Name | Description |
| --- | --- |
| `OSSRH_USERNAME` | Sonatype repository username |
| `OSSRH_PASSWORD` | Sonatype repository password |
| `GPG_PASSPHRASE` | Passphrase for GPG private key |
| `GPG_PRIVATE_KEY` | GPG private key (optional, uses default if not set) |

## Examples

### Without Android

```yaml
targets:
  - name: maven
    mavenCliPath: scripts/mvnw.cmd
    mavenSettingsPath: scripts/settings.xml
    mavenRepoId: ossrh
    mavenRepoUrl: https://oss.sonatype.org/service/local/staging/deploy/maven2/
    android: false
```


### With Android

```yaml
targets:
  - name: maven
    mavenCliPath: scripts/mvnw.cmd
    mavenSettingsPath: scripts/settings.xml
    mavenRepoId: ossrh
    mavenRepoUrl: https://oss.sonatype.org/service/local/staging/deploy/maven2/
    android:
      distDirRegex: /^sentry-android-.*$/
      fileReplaceeRegex: /\d\.\d\.\d(-SNAPSHOT)?/
      fileReplacerStr: release.aar
```

## Navigation

- [Docs home](https://craft.sentry.dev/pr-preview/pr-850/index.md)
- [Parent: Targets Overview](https://craft.sentry.dev/pr-preview/pr-850/targets.md)
- [Previous: Hex](https://craft.sentry.dev/pr-preview/pr-850/targets/hex.md)
- [Next: NPM](https://craft.sentry.dev/pr-preview/pr-850/targets/npm.md)
