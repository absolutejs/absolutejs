#!/bin/bash
# Use the patched Bun binary that includes reactFastRefresh on Bun.Transpiler
# (PR: https://github.com/oven-sh/bun/pull/28312)
#
# This is a temporary hack until the PR is merged. Once merged, use:
#   bunx bun.pr 28312
# Or just update Bun when the next release includes it.
#
# Usage:
#   source scripts/use-patched-bun.sh
#   bun run dev
#
# Or prefix any command:
#   ./scripts/use-patched-bun.sh bun run dev

PATCHED_BUN="$HOME/alex/bun-transpiler-patch/build/release/bun"

if [ ! -f "$PATCHED_BUN" ]; then
    echo "Patched Bun not found at $PATCHED_BUN"
    echo "Build it: cd ~/alex/bun-transpiler-patch && bun run build:release"
    exit 1
fi

if [ $# -gt 0 ]; then
    # Run command with patched bun
    PATH="$(dirname "$PATCHED_BUN"):$PATH" exec "$@"
else
    # Source mode: update PATH for current shell
    export PATH="$(dirname "$PATCHED_BUN"):$PATH"
    echo "Using patched Bun: $($PATCHED_BUN --version)"
fi
