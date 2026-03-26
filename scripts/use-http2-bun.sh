#!/bin/bash
# Use the patched Bun binary that includes enableConnectProtocol for HTTP/2 SETTINGS
# This enables RFC 8441 WebSocket-over-HTTP/2 (Extended CONNECT)
#
# Usage:
#   source scripts/use-http2-bun.sh
#   bun run dev
#
# Or prefix any command:
#   ./scripts/use-http2-bun.sh bun run dev

PATCHED_BUN="$HOME/alex/bun-http2-patch/build/release/bun"

if [ ! -f "$PATCHED_BUN" ]; then
    echo "Patched Bun not found at $PATCHED_BUN"
    echo "Build it: cd ~/alex/bun-http2-patch && bun run build:release"
    exit 1
fi

if [ $# -gt 0 ]; then
    echo "Using HTTP/2 patched Bun: $("$PATCHED_BUN" --version) (enableConnectProtocol)" >&2
    PATH="$(dirname "$PATCHED_BUN"):$PATH" exec "$@"
else
    export PATH="$(dirname "$PATCHED_BUN"):$PATH"
    echo "Using HTTP/2 patched Bun: $($PATCHED_BUN --version)"
fi
