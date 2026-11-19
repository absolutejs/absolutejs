#!/usr/bin/env bash
# `bun.lock` maps @absolutejs/absolute to the repository itself, and Bun never
# installs the root package into its own node_modules. Without this link the
# example app's `@absolutejs/absolute/client` import does not resolve, so the
# typecheck and every fixture that imports the package by name fail.
set -euo pipefail

mkdir -p node_modules/@absolutejs
rm -rf node_modules/@absolutejs/absolute
ln -s ../.. node_modules/@absolutejs/absolute
test -f node_modules/@absolutejs/absolute/package.json
