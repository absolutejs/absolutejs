#!/bin/bash
set -e
cd "$(dirname "$0")"
if ! command -v zig &> /dev/null; then
    echo "Error: zig is required for native builds. Install from https://ziglang.org/download/"
    exit 1
fi
echo "Cross-compiling native addon for all platforms..."

# Linux
zig build-lib src/fast_ops.zig -dynamic -O ReleaseFast -target x86_64-linux-gnu -femit-bin=packages/linux-x64/fast_ops.so
zig build-lib src/fast_ops.zig -dynamic -O ReleaseFast -target aarch64-linux-gnu -femit-bin=packages/linux-arm64/fast_ops.so

# macOS
zig build-lib src/fast_ops.zig -dynamic -O ReleaseFast -target x86_64-macos -femit-bin=packages/darwin-x64/fast_ops.dylib
zig build-lib src/fast_ops.zig -dynamic -O ReleaseFast -target aarch64-macos -femit-bin=packages/darwin-arm64/fast_ops.dylib

# Windows
mkdir -p packages/windows-x64 packages/windows-arm64
zig build-lib src/fast_ops.zig -dynamic -O ReleaseFast -target x86_64-windows-gnu -femit-bin=packages/windows-x64/fast_ops.dll
zig build-lib src/fast_ops.zig -dynamic -O ReleaseFast -target aarch64-windows-gnu -femit-bin=packages/windows-arm64/fast_ops.dll

echo "All 6 platform builds complete:"
ls -lh packages/*/fast_ops.*
