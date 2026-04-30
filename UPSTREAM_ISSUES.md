# Upstream Issues

Tracked upstream bugs in tooling AbsoluteJS depends on, plus what (if anything)
to do when each lands. Each entry lists the symptom we hit, where we patched
on our side, and what changes once upstream is fixed.

## Bun — `import()` masks evaluation errors after first throw

**Tracking:** [oven-sh/bun#29791](https://github.com/oven-sh/bun/issues/29791)
**Status:** Fixed on main; awaiting release of Bun 1.3.14. Reproduces on
Bun 1.3.13 (latest stable as of filing). The WebKit module-loader rewrite
in [oven-sh/bun#29393](https://github.com/oven-sh/bun/pull/29393) (merged
2026-04-25, commit 73e8889f8c) addressed it; verified by robobun on Bun
1.3.14-canary.1+db12b449f. **Action when 1.3.14 ships:** see "What to do
when Bun fixes the loader" below.

### What's wrong upstream

When `await import(path)` evaluates a module whose top-level code throws,
the first import correctly rejects. The **second** sequential `import()` of
the same path returns a partially-initialized module record (e.g. `default:
undefined`) instead of re-throwing the original error, in violation of the
ESM spec. Node behaves correctly. See the linked issue for minimal repros.

### How it bit AbsoluteJS

`src/build/compileAngular.ts` used to derive the page-component class name
from the source filename: `${toPascal(fileBase)}Component`. When a user
page named e.g. `resources.ts` exported a class with a non-conforming name
like `ContentComponent`, the appended `export default ResourcesComponent;`
referenced an identifier that was never declared — a dangling reference in
the bundled output.

Bun's loader masking made this look like an HMR race instead of a hard
codegen bug: first request to that route 500'd with `ResourcesComponent is
not defined`; second and subsequent requests succeeded (with `default ===
undefined`, which the framework's `resolvePageComponent` fallback then
papered over by scanning named exports). End-to-end the symptom was
"first-hit flaky, retries pass" — easy to mistake for a rebuild race.

### What we did on our side

Patched `compileAngular.ts` in **beta.719** to parse the actual exported
class from the source (`detectExportedComponentClass`) instead of guessing
from the filename. The filename heuristic is preserved as a final
fallback so existing example projects whose names match the convention
keep working.

### What to do when Bun fixes the loader

**Nothing has to change.** The class-name detection is correct
regardless — it removes the trigger of the dangling-reference bundle
emit, not a workaround for Bun's caching behavior. The user-visible
difference is:

- Today: a sloppy bundle with a dangling reference 500s once then
  silently degrades. Easy to miss.
- Once fixed: the same bundle 500s on **every** request, surfacing the
  real bug immediately.

Optional follow-ups when the fix ships:

1. **Bump the minimum Bun version** (`engines.bun` in `package.json`) to
   the first release containing the fix, so anyone using AbsoluteJS gets
   the louder failure mode.
2. **Add a regression test** under `tests/` that loads a deliberately
   dangling page module twice and asserts the second `import()` rejects
   with the same error as the first. This catches both regressions of the
   class-name detection and any future loader regression in Bun.
3. **Refresh the in-code comment** in `compileAngular.ts` near
   `detectExportedComponentClass` to mention "this also surfaces loader
   regressions early" once the masking is gone.

No other code changes needed.
