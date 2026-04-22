#!/bin/bash
set -e
cd "$(dirname "$0")"
VERSION=$(node -p "require('../package.json').version")
EXTRA_ARGS="$@"
for dir in packages/linux-x64 packages/linux-arm64 packages/darwin-x64 packages/darwin-arm64 packages/windows-x64 packages/windows-arm64; do
    pkg="$dir/package.json"
    node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('$pkg','utf-8'));p.version='$VERSION';fs.writeFileSync('$pkg',JSON.stringify(p,null,'\t')+'\n');"
    echo "Publishing $(node -p "require('./$pkg').name")@$VERSION..."
    (
        cd "$dir"
        bun publish --access public $EXTRA_ARGS
    )
done
echo "All native packages published at version $VERSION."
