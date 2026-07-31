#!/bin/bash
set -e
cd "$(dirname "$0")"
VERSION=$(node -p "require('../package.json').version")
EXTRA_ARGS="$@"
for dir in packages/linux-x64 packages/linux-arm64 packages/darwin-x64 packages/darwin-arm64 packages/windows-x64 packages/windows-arm64; do
    pkg="$dir/package.json"
    PACKAGE_VERSION=$(node -p "require('./$pkg').version")
    if [ "$PACKAGE_VERSION" != "$VERSION" ]; then
        echo "Error: $(node -p "require('./$pkg').name") is $PACKAGE_VERSION but root is $VERSION."
        exit 1
    fi
    echo "Publishing $(node -p "require('./$pkg').name")@$VERSION..."
    (
        cd "$dir"
        bun publish --access public $EXTRA_ARGS
    )
done
echo "All native packages published at version $VERSION."
