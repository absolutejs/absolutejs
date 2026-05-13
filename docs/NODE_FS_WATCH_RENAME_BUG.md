# Node — `fs.watch(recursive: true)` drops `IN_MOVED_TO` on overwrite renames (Linux)

**Tracking:** none filed yet — search `nodejs/node` issues before opening,
behavior is well-known but I haven't pinned a single canonical bug.
**Status:** Reproduces deterministically on Node-API parity surface
(Bun 1.3.13's `node:fs.watch`, also reported on Node 22 historically).
Workaround landed in this repo; see "Workaround." **Action when fixed:**
see "What to do when Node fixes it."

## What's wrong upstream

`fs.watch(dir, { recursive: true }, cb)` on Linux fires `IN_MOVED_FROM`
for the source filename of an atomic rename, but **drops `IN_MOVED_TO`
for the destination filename when the destination already existed in
the watched dir** — i.e. the editor save case (`sed -i`, `vim`'s default
write, `prettier`, `:w` on most modern setups, VSCode atomic save,
JetBrains, etc.). All of those write a temp file (`sedXXXXXX`,
`.foo.swp`, etc.) then `rename(2)` it over the real target.

Inotify's kernel-level event pair is correct: `IN_MOVED_FROM
sedXXXXXX` + `IN_MOVED_TO foo.ts`. Both events have the same cookie.
Node's recursive-watch wrapper (libuv `uv_fs_event` + Node's tree
walker on Linux) appears to deliver only the first. Result: every
"normal save" to an existing file is **invisible** to the JS handler.

## Minimal repro

```sh
mkdir /tmp/fs-watch-bug && cd /tmp/fs-watch-bug
echo 'export const v = "A";' > file.ts
node -e '
  const { watch } = require("fs");
  watch(".", { recursive: true }, (event, filename) => {
    console.log({ event, filename });
  });
  setTimeout(() => {}, 60000);
' &
sleep 1
sed -i 's/A/B/' file.ts
sleep 1
```

Expected: at least one event reporting filename `file.ts` (the rename
target). Observed: only `{ event: "rename", filename: "sed*" }` for
the temp filename. The destination event is missing. Same on Bun's
node:fs polyfill.

(I haven't reduced this to a clean Node-only repro yet — Bun's
node:fs.watch is what shows the bug in our codebase. If filing
upstream, run the same thing under stock Node 20+ on Linux to
confirm.)

## How it bit AbsoluteJS

The dev-server-internal `fileWatcher.ts` watches framework dirs
recursively. Frontend-source HMR (Angular component edits, etc.)
relies on these events firing for the real filename so
`detectFramework` / `rebuildTrigger` can route to the right HMR tier.

With the missing `IN_MOVED_TO`, every editor save was either:

- silently no-op'd (when the temp filename was filtered upstream),
  or
- routed through the unknown-classification path that emits
  `[abs:restart]` (full child restart — wrong for anything that
  *should* hit Tier 0/1 angular HMR).

We confirmed this by editing `utils/format.ts` (transitively imported
by an angular component): without the workaround, the watcher saw
only `rename sed27rRbV` and lost the actual `format.ts` event. The
framework then either restarted the whole child or did nothing,
depending on filter ordering.

## Workaround

In `src/dev/fileWatcher.ts`, when `shouldSkipFilename` matches an
atomic-write temp pattern AND the event is `rename`, run an
**atomic-rename recovery scan** over the same parent dir:

```ts
const ATOMIC_RECOVERY_WINDOW_MS = 1000;
const recentlySynthesized = new Map<string, number>();
const atomicRecoveryScan = (eventDir: string) => {
  // walk eventDir, find files with ctime within last 1s,
  // synthesize onFileChange for each (deduplicated within 100ms)
};
```

Triggered from the watch callback right before the temp-skip return:

```ts
if (shouldSkipFilename(filename, isStylesDir)) {
  if (event === 'rename') {
    atomicRecoveryScan(dirname(join(absolutePath, filename)));
  }
  return;
}
```

Ctime catches the rename target reliably because `rename(2)`
updates ctime on the destination. The 1s window is generous enough
to cover slow editor write paths but tight enough not to scoop up
unrelated files. The 100ms dedup map prevents the same file being
synthesized twice when the recursive watch happens to also deliver
a normal `change` event for it within the same burst.

Atomic-write temp patterns currently caught:

- sed: `/^sed[A-Za-z0-9]{6,}$/`
- vim probe file: `/^4913$/`
- generic suffixes already covered: `.tmp`, `.tmp.*`, `~`, `.#*`

If a user's editor uses a different atomic-write naming scheme,
add it to either `ATOMIC_WRITE_TEMP_PATTERNS` (regex) or the
suffix list.

## What to do when Node fixes it

When `fs.watch(recursive: true)` on Linux reliably delivers
`IN_MOVED_TO` for overwrite renames:

1. **Delete** the `atomicRecoveryScan` block + `recentlySynthesized`
   map + the recovery branch in the watch callback in
   `src/dev/fileWatcher.ts`.
2. **Keep** `ATOMIC_WRITE_TEMP_PATTERNS` and the
   `shouldSkipFilename` matching — temp-file filtering is correct
   regardless. We just don't need to scan-recover after them
   anymore because the real rename target will fire its own event.
3. Verify `utils/format.ts` edit propagates without restart and
   without the recovery scan (i.e. via the natural `change
   format.ts` event).
4. Bump the minimum Node / Bun version in `package.json`'s
   `engines` to whatever release contains the fix.

## Independent of the bun bug

Unlike `docs/BUN_HOT_WATCHER_BUG.md` (which is a Bun `--hot` issue), this
one is a **Node `fs.watch` issue**. They're independent. Even when
Bun fixes `--hot`, we still need this workaround for the framework's
own internal file watcher (which uses `node:fs.watch`, not bun's
`--hot`). Don't conflate them when removing workarounds.
