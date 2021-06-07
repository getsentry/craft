#!/bin/bash
set -eux

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd $SCRIPT_DIR/..

OLD_VERSION="$1"
NEW_VERSION="$2"

# Do not tag and commit changes made by "npm version"
export npm_config_git_tag_version=false

NPM_VERSION=$(npm version $NEW_VERSION)
VERSION=${NPM_VERSION:1}
echo "New version: $VERSION"
