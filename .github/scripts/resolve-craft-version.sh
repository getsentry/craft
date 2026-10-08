#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "Expected the requested version, action ref, and action path" >&2
  exit 1
fi

version="$1"
if [[ -z "$version" ]]; then
  version="$2"
  if [[ "$version" =~ ^[0-9a-f]{7,64}$ ]]; then
    sha="$version"
    if [[ ${#sha} -ne 40 && ${#sha} -ne 64 ]]; then
      if ! commit="$(gh api "repos/getsentry/craft/commits/$sha")"; then
        echo "Could not resolve action commit SHA $sha" >&2
        exit 1
      fi
      sha="$(jq -er '.sha | select(type == "string")' <<< "$commit")"
      if [[ ! "$sha" =~ ^[0-9a-f]{40}$ && ! "$sha" =~ ^[0-9a-f]{64}$ ]] || [[ "$sha" != "$version"* ]]; then
        echo "The action ref is not an unambiguous Craft commit SHA" >&2
        exit 1
      fi
    fi

    version="$(jq -er '.version | select(type == "string")' "$3/package.json")"
    if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
      echo "The SHA-pinned action does not declare a Craft version" >&2
      exit 1
    fi

    if [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+-dev\.0$ ]]; then
      version="nightly-$sha"
    else
      if ! ref="$(gh api "repos/getsentry/craft/git/ref/tags/$version")"; then
        echo "Could not verify Craft release tag $version" >&2
        exit 1
      fi
      if ! jq -e --arg tag "refs/tags/$version" --arg sha "$sha" '.ref == $tag and .object.type == "commit" and .object.sha == $sha' <<< "$ref" >/dev/null; then
        echo "Craft release tag $version does not point to action SHA $sha" >&2
        exit 1
      fi

      if ! release="$(gh api "repos/getsentry/craft/releases/tags/$version")"; then
        echo "Could not verify published Craft release $version" >&2
        exit 1
      fi
      if ! jq -e --arg version "$version" '.tag_name == $version and .draft == false and any(.assets[]?; .name == "craft" and .state == "uploaded")' <<< "$release" >/dev/null; then
        echo "No published Craft release with a downloadable binary matches action SHA $sha" >&2
        exit 1
      fi
    fi
  fi
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

if [[ "$version" == 'master' ]]; then
  version='nightly'
fi

if [[ "$version" == nightly-* && ! "$version" =~ ^nightly-([0-9a-f]{40}|[0-9a-f]{64})$ ]]; then
  echo "Invalid Craft nightly tag" >&2
  exit 1
fi

if [[ ! "$version" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]]; then
  echo "Invalid Craft release tag" >&2
  exit 1
fi

printf '%s\n' "$version"
