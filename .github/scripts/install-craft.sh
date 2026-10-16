#!/usr/bin/env bash
# Select the Action's source; the public installer owns native installation.
set -euo pipefail
[[ $# == 2 ]] || { echo 'Expected Craft version and installation directory' >&2; exit 1; }
version=$1
directory=${2//\\//}
[[ "$version" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]] || { echo 'Invalid Craft release tag' >&2; exit 1; }
action_path=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
platform=$(node -p "process.platform === 'win32' ? 'win' : process.platform")
arch=$(node -p 'process.arch')
asset="craft-$platform-$arch.gz"
if [[ "$platform" == win ]]; then asset="craft-win-$arch.exe"; fi

install_native() {
  # Dry-run applies to release operations, not provisioning Craft itself.
  CRAFT_DRY_RUN= DRY_RUN= bash "$action_path/install" --version "$version" --install-dir "$directory" --install-only "$@"
}

CRAFT_NATIVE_ARTIFACT_DIRECTORY=${CRAFT_NATIVE_ARTIFACT_DIRECTORY:-}
CRAFT_NATIVE_ARTIFACT_DIRECTORY=${CRAFT_NATIVE_ARTIFACT_DIRECTORY//\\//}
CRAFT_LEGACY_ARTIFACT=${CRAFT_LEGACY_ARTIFACT:-}
CRAFT_LEGACY_ARTIFACT=${CRAFT_LEGACY_ARTIFACT//\\//}
archive="$CRAFT_NATIVE_ARTIFACT_DIRECTORY/$asset"
if [[ -n "${CRAFT_NATIVE_ARTIFACT_DIRECTORY:-}" && -f "$archive" ]]; then
  version=${CRAFT_ARTIFACT_VERSION:?Missing native artifact version}
  install_native --archive "$archive"
else
  mkdir -p "$directory"
  stage=$(mktemp -d "$directory/.craft-action.XXXXXXXX")
  trap 'rm -rf "$stage"' EXIT
  if [[ -n "${CRAFT_LEGACY_ARTIFACT:-}" && -f "$CRAFT_LEGACY_ARTIFACT" ]]; then
    cp "$CRAFT_LEGACY_ARTIFACT" "$stage/craft"
  elif [[ "$version" == nightly* ]]; then
    node "$action_path/.github/scripts/download-craft-nightly.mjs" "$version" "$stage/craft"
  else
    endpoint="tags/$version"
    if [[ "$version" == latest ]]; then endpoint=latest; fi
    gh api "repos/getsentry/craft/releases/$endpoint" > "$stage/release.json"
    jq -e --arg version "$version" '.draft == false and (.tag_name | type == "string") and ($version == "latest" or .tag_name == $version) and (.assets | type == "array")' "$stage/release.json" >/dev/null
    version=$(jq -er '.tag_name' "$stage/release.json")
    [[ "$version" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]] || exit 1
    count=$(jq --arg asset "$asset" '[.assets[] | select(.name == $asset)] | length' "$stage/release.json")
    if [[ "$count" != 0 ]]; then
      [[ "$count" == 1 ]] || { echo 'Duplicate Craft native asset' >&2; exit 1; }
      jq -e --arg asset "$asset" 'any(.assets[]; .name == $asset and .state == "uploaded")' "$stage/release.json" >/dev/null
      install_native
    else
      jq -e '[.assets[] | select(.name == "craft" and .state == "uploaded")] | length == 1' "$stage/release.json" >/dev/null
      curl --proto '=https' --proto-redir '=https' --tlsv1.2 -fsSL --max-time 180 --max-filesize 268435456 "https://github.com/getsentry/craft/releases/download/$version/craft" -o "$stage/craft"
    fi
  fi
  if [[ -f "$stage/craft" ]]; then
    [[ -s "$stage/craft" ]] || { echo 'Empty Craft executable' >&2; exit 1; }
    chmod 755 "$stage/craft"
    [[ ! -L "$directory/craft" && ! -d "$directory/craft" ]] || { echo 'Installation target must be a regular file' >&2; exit 1; }
    mv -f "$stage/craft" "$directory/craft"
    echo "Installed JavaScript Craft: $directory/craft"
  fi
fi
if [[ -n "${GITHUB_PATH:-}" ]]; then printf '%s\n' "$directory" >> "$GITHUB_PATH"; fi
