#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "Expected the requested version, action ref, and action path" >&2
  exit 1
fi

version="$1"
if [[ -z "$version" ]]; then
  version="$2"
fi

if [[ "$version" =~ ^v([1-9][0-9]*)$ ]]; then
  major="${BASH_REMATCH[1]}"
  version="$(jq -er '.version | select(type == "string")' "$3/package.json")"
  if [[ ! "$version" =~ ^${major}\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]; then
    echo "The v${major} action ref does not point to a published v${major} version" >&2
    exit 1
  fi
fi

if [[ -z "$version" ]]; then
  version="latest"
fi

if [[ ! "$version" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]]; then
  echo "Invalid Craft release tag" >&2
  exit 1
fi

printf '%s\n' "$version"
