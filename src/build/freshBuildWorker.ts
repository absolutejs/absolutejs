// Worker script for incremental builds with fresh module cache.
// Spawned as a subprocess so Bun's ESM module cache is clean,
// ensuring Bun.build() reads changed files from disk.
//
// Receives BuildConfig as JSON on argv[2], writes manifest JSON to stdout.

import { build } from '../core/build';

const config = JSON.parse(process.argv[2]!);
const manifest = await build(config);
// Write manifest as the LAST line of stdout so the parent can parse it
console.log(`__MANIFEST__${JSON.stringify(manifest)}`);
