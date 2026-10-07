#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "Expected the requested version, action ref, and action path" >&2
  exit 1
fi

version="$1"
if [[ -z "$version" ]]; then
  version="$2"
  if [[ "$version" =~ ^[0-9a-f]{40}$ ]]; then
    matching_tags='[]'
    page=1
    while :; do
      tags="$(gh api "repos/getsentry/craft/tags?per_page=100&page=$page")"
      if ! jq -e 'type == "array"' <<< "$tags" >/dev/null; then
        echo "Invalid Craft tags response" >&2
        exit 1
      fi
      page_tags="$(jq -c --arg sha "$version" '[.[] | select(.commit.sha == $sha and (.name | test("^[0-9]+\\.[0-9]+\\.[0-9]+(-[0-9A-Za-z.-]+)?$"))) | .name]' <<< "$tags")"
      matching_tags="$(jq -nc --argjson previous "$matching_tags" --argjson current "$page_tags" '$previous + $current')"
      if [[ "$(jq 'length' <<< "$tags")" -lt 100 ]]; then
        break
      fi
      page=$((page + 1))
    done
    if [[ "$matching_tags" == '[]' ]]; then
      echo "No published Craft release with a downloadable binary matches action SHA $version" >&2
      exit 1
    fi

    page=1
    while :; do
      releases="$(gh api "repos/getsentry/craft/releases?per_page=100&page=$page")"
      if ! jq -e 'type == "array"' <<< "$releases" >/dev/null; then
        echo "Invalid Craft releases response" >&2
        exit 1
      fi

      tag="$(jq -r --argjson tags "$matching_tags" '[.[] | select(.draft == false and any(.assets[]?; .name == "craft" and .state == "uploaded") and (.tag_name as $name | $tags | index($name) != null)) | .tag_name] | first // empty' <<< "$releases")"
      if [[ -n "$tag" ]]; then
        version="$tag"
        break
      fi
      if [[ "$(jq 'length' <<< "$releases")" -lt 100 ]]; then
        echo "No published Craft release with a downloadable binary matches action SHA $version" >&2
        exit 1
      fi
      page=$((page + 1))
    done
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

if [[ ! "$version" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]]; then
  echo "Invalid Craft release tag" >&2
  exit 1
fi

printf '%s\n' "$version"
