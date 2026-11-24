# Why Angular compiles differently in dev and production

Dev compiles Angular with JIT; production uses Angular's AOT compiler.
That is deliberate, and this is the measurement behind it — written down
because the comment that used to justify it was wrong in both directions.

## The numbers

Measured on this repository, per **edit** — one file changed, which is
what a dev tick actually does:

| tree | AOT | JIT |
| --- | --- | --- |
| 5 components | 515 ms | 1 ms |
| 25 components | 637 ms | 3 ms |
| 50 components | 743 ms | 4 ms |

Unchanged, with the cache warm, AOT is 43–59 ms. Cold it is 1.1–1.4 s.

**The warm number is the one that misleads.** Dev never recompiles an
unchanged tree, and the moment a file changes the cache cannot help:
**AOT has no per-file path — it compiles a program.**

## It is not only speed

The dev tick is 8–56 ms of server work plus 5–13 ms to apply in the
browser, through `compileAngularFileJIT` — a *file-level* compiler. That
path exists because a single file can be compiled on its own.

AOT cannot do that. Adopting it in dev would cost the per-component
remount path (`tier-0`) as well as the time, and that path is what the
vendored LView helpers in `src/dev/client/vendor/lview/` exist to serve.

So the split is load-bearing rather than an accident: **JIT is what makes
per-component Angular HMR possible at all.**

## What it costs, and what pays for it

The cost is that a bug can live in one compiler and not the other, and
nothing notices.

`tests/unit/angular/jitAotParity.test.ts` is that seam. It compiles one
page both ways and asserts the things a page depends on, rather than the
text — the two outputs are *meant* to differ:

- the **page root** is the same class in both (picking the wrong one
  renders the wrong component, and a change to either compiler's output
  shape can move the picker's answer);
- both export the page, its routed child and `routes`;
- both carry the injected router with the same features;
- both leave `@defer` to Angular rather than lowering it;
- and the differences that are intended are pinned, so the test cannot be
  "fixed" by making one path imitate the other.

## What `@defer` actually does

Both paths leave the block alone. Angular handles it, at different times:
AOT compiles the template at build time, JIT keeps the decorator and lets
Angular's runtime compiler read it.

The framework's own `lowerAngularDeferSyntax` serves other flows, such as
partial prerendering — not this one. The first version of the parity test
asserted the opposite and failed, which is how this got written down.
