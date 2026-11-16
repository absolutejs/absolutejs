# Typed manifest keys: the editor can lag the source

Internal note (2026-11-15). Status: known limitation, accepted for now. We may
revisit it with the AbsoluteJS VS Code extension (`~/abs/absolutejs-vscode-extension`),
TBD.

## What it is

`asset(manifest, key)` is typed by `.absolutejs/types/manifest.d.ts`
(`src/build/manifestKeys.ts`, beta.180). It adds every key a build of the
project would write to `AbsoluteManifestKeys`. Three things write it:

- `absolute dev`: `src/dev/manifestKeysRefresher.ts`, as pages, styles and
  islands change;
- `absolute build`: `src/core/build.ts`;
- `absolute typecheck`: `src/cli/scripts/typecheck.ts` regenerates it, then
  checks.

So the CLI typecheck, CI and the release gate are never stale.

## Where it lags

Only in the editor, and only while none of those is running. Add or rename a
page with no dev server up, and the editor's TypeScript server keeps reading
the old declaration:

- a new page's key is a type error until dev, build or typecheck next runs
  (a false error: the build would write it);
- a deleted or renamed page's old key still type-checks in the editor (a
  false pass). The CLI typecheck catches it.

A missing declaration (fresh clone: it is gitignored) is not a lag: the
interface is empty and `asset` accepts any string, so nothing is blocked.

## Options if it becomes a problem

1. **The VS Code extension regenerates it.** On save of a file under a page,
   style or island directory, run the same derivation
   (`writeManifestKeysDeclaration`) and let the TS server pick up the
   rewritten file. The derivation is source-only (no bundling) and the
   writer skips unchanged output, so this is cheap.
2. **A TS server plugin** that derives the keys in-process, so no file is
   involved. More moving parts; editor-agnostic for any TS editor, not just
   VS Code.
3. **Generate it at install** (`postinstall`) as well. That only fixes a
   fresh clone, which is already permissive, so it's the least useful.

Leaning (1) when we pick this up, because the extension is already ours.
