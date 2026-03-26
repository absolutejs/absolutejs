#!/bin/bash
# Use the combined patched Bun with:
# 1. reactFastRefresh on Bun.Transpiler (PR #28312)
# 2. enableConnectProtocol for HTTP/2 WebSocket (RFC 8441)
#
# Usage:
#   source scripts/use-combined-bun.sh
#   bun run dev
#
# Or prefix any command:
#   ./scripts/use-combined-bun.sh bun run dev

PATCHED_BUN="$HOME/alex/bun-combined-patch/build/release/bun"

if [ ! -f "$PATCHED_BUN" ]; then
    echo "Combined patched Bun not found at $PATCHED_BUN"
    echo "Build it: cd ~/alex/bun-combined-patch && bun run build:release"
    exit 1
fi

if [ $# -gt 0 ]; then
    echo "Using combined patched Bun: $("$PATCHED_BUN" --version) (reactFastRefresh + enableConnectProtocol)" >&2
    PATH="$(dirname "$PATCHED_BUN"):$PATH" exec "$@"
else
    export PATH="$(dirname "$PATCHED_BUN"):$PATH"
    echo "Using combined patched Bun: $($PATCHED_BUN --version)"
fi
