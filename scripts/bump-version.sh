#!/bin/bash
set -eux

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd $SCRIPT_DIR/..

if [ -z "${1:-}" ]; then
    set -- "patch"
fi

NPM_VERSION=$(npm version $1)
VERSION=${NPM_VERSION:1}

git add package.json
git commit -m "release: $VERSION"
