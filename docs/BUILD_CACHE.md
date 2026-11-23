# Production build caching

What a production build reuses between runs, what it still recomputes, and
how to turn any of it off.

All of it lives under `.absolutejs/cache/`, which is gitignored. Deleting
that directory is always safe: the next build is slower and identical.

## What is cached

| | cache | opt out |
| --- | --- | --- |
| Angular AOT compile | `.absolutejs/cache/angular-aot` | `ABSOLUTE_AOT_CACHE=0` |
| Angular linker (partial-compiled libraries) | `.absolutejs/cache/angular-linker` | — |
| Angular component resources (templates, styles) | `.absolutejs/cache/angular-resources` | — |

These are production caches. The dev vendor cache
(`ABSOLUTE_DEV_VENDOR_CACHE=0`) and the dev transform cache are separate and
only apply to `absolute dev`.

## Where a production build's time goes

Measured on the example app with `absolute build --profile`, which traces
every phase. Medians of 3 cold and 5 warm runs — run-to-run variance is
high, up to 40% between identical runs, so treat these as proportions
rather than benchmarks.

| | cold (no `.absolutejs/cache`) | warm |
| --- | --- | --- |
| wall clock | 3.70s | 2.33s |
| traced total | 2.65s | 1.51s |
| `aot/compile-files` | ~977ms | **~200ms** |
| Angular vendors (concurrent pair) | ~790ms | ~144ms |
| React + Vue + Svelte vendors | 37ms combined | 37ms |

The shape worth knowing: **the cost is Angular and almost nothing else.**
React, Vue and Svelte vendor passes together are under 40ms, so there is
nothing to win by caching them.

## The AOT cache

Angular AOT is compiled as **one program over every entry point**, not file
by file, so there is no per-file compile to cache. The unit is the whole
emit: a hit reuses all of it, a miss recompiles all of it.

A hit takes `aot/compile-files` from ~977ms to ~200ms, and
`aot/perform-compilation` — ~744ms of that — does not run at all.

### What makes it safe

The cache validates by hashing **every file the compiler actually read**.
That is 609 files on the example app, 603 of them in `node_modules`, 8.8MB
in total — and hashing all of them costs **16ms**, against the ~744ms it
saves. There is no need to guess at a smaller subset, so it doesn't.

The file list can't be known before compiling, so it's recorded during a
compile and re-checked on the next one. That's sound: a file newly pulled
into the program has to be imported by some file already in it, and that
file's content therefore changed.

**It hashes effective content, not what's on disk.** This is the part a
naive cache gets wrong. The compiler never reads your components from
disk — it's handed copies with `templateUrl` and `styleUrls` already
inlined. A key built from disk contents wouldn't move when a template
changed, and you'd get a component compiled against the old HTML. Hashing
what the compiler is actually handed folds template and style changes in
automatically.

Verified by changing each kind of input and confirming a recompile: an
external template, a component `.ts`, a project file that is not an entry
point, and a file in `node_modules`. The compiler options, the TypeScript
lib directory, the style-preprocessor config and the lockfile are all in
the key too.

Everything fails open. A corrupt entry, a truncated write, a missing file
or an unknown format version is a miss and an ordinary compile — never a
build failure. Entries are written to a temporary path and renamed, so a
build that dies midway can't leave half an entry behind.

### When it helps

Repeat builds on the same machine: a developer running `absolute build`
more than once, or a CI job that restores `.absolutejs/cache` between runs.

A genuinely fresh checkout has no cache and pays full price — the first
build is unchanged. If your CI caches nothing, this changes nothing for it.

## Finding out for yourself

```bash
absolute build --profile
```

prints the slowest phases and a per-framework breakdown. `aot/cache-lookup`
and `aot/cache-store` show the cache being consulted and written;
`aot/perform-compilation` missing from the list means it was a hit.
