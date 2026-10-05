# Upstream Issues

Bugs and footguns in AbsoluteJS's **dependencies** (Bun, Elysia, …) that bite
AbsoluteJS apps — especially compiled (`absolute compile`) apps deployed to
strict/sandboxed hosts like DigitalOcean App Platform. We can't fix these in our
code, but we track them here with the symptom, root cause, a workaround, and the
upstream issue to watch. Remove an entry once the upstream fix ships and we've
bumped past it.

## Current status

Last full re-check: **2026-10-05**, on **Bun 1.4.2** and **Elysia
2.0.0-beta.21**. Every entry was re-run against those versions, not judged by
its issue's state. Upstream closes issues that are not fixed (as a duplicate,
"unable to reproduce", or "fixed" for a narrower case), so **only a passing
repro retires an entry**.

| # | Problem | Upstream | Fixed? |
| --- | --- | --- | --- |
| 3 | `@playwright/mcp` orphans Chrome trees | playwright#41013 closed (dismissed), #43098 open | No |
| 4 | Svelte HMR drops `$state` | svelte#17995 (ours) open | No |
| 5 | Tailwind v4 at-rule warnings | bun#12878 open | No (1.4.2) |
| 6 | `String.raw` escapes non-ASCII on `target: "bun"` | bun#8745 open | No (1.4.2) |
| 7 | `Bun.Transpiler` ignores `reactFastRefresh` | bun#32919 (ours) open | No (1.4.2) |

Resolved entries are kept at the end so the fix is on record.

### Needs action upstream

- **#6:** comment on bun#8745. It is still broken on 1.4.2, it breaks SSR
  hydration, and both fix PRs (#33867, #33868) were closed unmerged.
- **#7:** ask on bun#32919 for the closed fix (#32951) to be reopened or
  folded into #42010, with the 1.4.2 probe in #7 below.

---

## 3. `@playwright/mcp` orphans Chrome process trees when the MCP host dies

- **Dependency:** `@playwright/mcp` (Microsoft) — source actually lives in
  `playwright-core` at `packages/playwright-core/src/tools/mcp/watchdog.ts`
- **Status:** still applies; upstream dismissed it (re-checked 2026-10-05)
  - **microsoft/playwright#41013** (our report, deterministic repro) — **closed
    2026-06-08** by the maintainer as "the problem seems to be on the client
    end": https://github.com/microsoft/playwright/issues/41013
  - microsoft/playwright#41089 — "fix(mcp): close browser when host dies
    without a signal" — **closed unmerged** with it:
    https://github.com/microsoft/playwright/pull/41089
  - microsoft/playwright#41017 — maintainer investigation "cannot reproduce
    orphan Chrome trees" — closed
  - **microsoft/playwright#43098** — **open**, related: on stdin EOF the stdio
    server force-kills its own browser 1 ms after start (the shutdown path is
    still being reworked): https://github.com/microsoft/playwright/issues/43098
  - Earlier: microsoft/playwright#41009 (closed), microsoft/playwright-mcp#1634,
    #1568, #1512 (closed, "no repro")

**Symptom.** Doesn't bite **deployed** AbsoluteJS apps — bites the **dev
environment** any time an AI agent (Claude Code, Cursor, etc.) uses the
`@playwright/mcp` server for browser automation. After hours/days of normal use,
`pgrep -a -f 'ms-playwright/mcp-chrome'` shows multiple Chrome process trees
re-parented to PID 1, each 200-500MB, sometimes burning a full core via
SwiftShader software rendering after the parent is gone. On WSL with a fixed
memory cap this drives the VM toward swap and slows everything else (TS server,
bundlers, your AbsoluteJS app process).

**Root cause.** `watchdog.ts` only listens for `SIGINT`, `SIGTERM`, and
`process.stdin.on('close')`. None of those fire when:
- the parent MCP host is SIGKILL'd (no signal reaches the MCP server), or
- the parent sits behind an `npm exec` / `npx` intermediary (standard MCP
  config: `{ "command": "npx", "args": ["@playwright/mcp@latest"] }`) which
  swallows the stdin-close propagation.
- the watchdog's 15s hard-exit `setTimeout(() => process.exit(0), 15000)`
  calls `process.exit` **without** invoking `killSet` first, so even when it
  does run, a slow `gracefullyCloseAll()` leaves chrome alive.

**Workaround.** Periodically nuke orphan process trees. Safe to run any time —
`@playwright/mcp` re-spawns Chrome on the next `browser_navigate`:

```bash
pgrep -f 'playwright-mcp' | xargs -r kill -9
pgrep -f 'ms-playwright/mcp-chrome' | xargs -r kill -9
# stale profile dirs older than 1h with no chrome attached:
find ~/.cache/ms-playwright -maxdepth 1 -name 'mcp-chrome-*' -type d -mmin +60 -exec rm -rf {} +
```

The same instructions live in `~/.claude/CLAUDE.md` so every Claude Code
session on the machine knows to triage this on its own.

**Detection.** `ps -eo pid,rss,etime,cmd --sort=-rss | grep -E "playwright|mcp-chrome" | head`
— if chrome processes are older than your longest active client session,
they're orphans. On WSL especially: watch `free -m` against expected per-AI
overhead; a persistent 1GB+ `node` is usually the TS server, but multiple
600MB+ Chrome renderers with `etime > 1h` and no active browser session is
this bug.

---
## 4. Svelte 5's `$.hmr()` does not preserve `$state` across HMR component swaps

- **Dependency:** Svelte (`svelte`)
- **Status:** our fix PR is still open upstream (re-checked 2026-10-05)
  - **sveltejs/svelte#17995** (our PR) — "feat: preserve $state across HMR
    component swaps" — **open**, last activity 2026-07-24:
    https://github.com/sveltejs/svelte/pull/17995
  - sveltejs/svelte#14434 — the long-standing feature request it fixes:
    https://github.com/sveltejs/svelte/issues/14434

**Symptom.** Dev-only. On a surgical Svelte HMR update (`$.hmr_accept`), any
reactive state that lives where the swap can't reach — composables
(`.svelte.ts` modules doing `$state(initialProp)`) and other setup-time-created
signals — resets to its initial value, because Svelte re-executes the
component's `<script>` body with the original props and a fresh `$state`.

**Root cause.** Stock Svelte 5's `$.hmr()` destroys the old effect tree and
re-creates the component without carrying signal values across. PR #17995 adds
`collect_state()` (walks the effect tree incl. composable/derived deps for
`$.tag()`-labeled signals) + restore-on-init via
`globalThis.__hmr_preserved_state__`, so the runtime preserves `$state`
natively — including composable state.

**Bandaid in AbsoluteJS** (issue #41, shipped `0.19.0-beta.1067`): re-mount the
page with a DOM-extracted state snapshot merged into props after the surgical
swap. It is fully prop-driven and counter-shaped (`extractCountFromDOM`), i.e.
a heuristic — the upstream fix is the real solution. The bandaid's full
footprint, for clean removal later:

1. `src/dev/client/handlers/svelte.ts` — the post-`acceptFn` remount block
   (reads `__HMR_PRESERVED_STATE__`, calls `window.__SVELTE_REMOUNT__`), plus
   the snapshot machinery it feeds on: `extractCountFromDOM`,
   `loadStateFromSession`/`saveStateToSession` (`__SVELTE_HMR_STATE__` in
   sessionStorage), and the `window.__HMR_PRESERVED_STATE__` assignment in
   `handleSvelteUpdate`.
2. `src/build/compileSvelte.ts` — the `window.__SVELTE_REMOUNT__` helper in the
   index bootstrap codegen, and the `isHMR` branch's
   `__HMR_PRESERVED_STATE__`/sessionStorage `mergedProps` merge (the
   bundled-fallback variant of the same bandaid).
3. `src/dev/moduleServer.ts` — `generateSvelteHmrBootstrap`'s DOM-count
   extraction + `__INITIAL_PROPS__` rewrite (legacy `/@hmr/svelte/` path).
4. `types/globals.d.ts` — the `__SVELTE_REMOUNT__` Window field.
   **Keep** `__HMR_PRESERVED_STATE__` — it is shared with the Vue and React
   HMR paths (`compileVue.ts`, `generateReactIndexes.ts`).

**Remove when:** a Svelte release containing #17995 ships **and** AbsoluteJS
bumps its `svelte` dependency past it. At that point `$.hmr_accept` preserves
composable `$state` natively, the remount becomes a redundant
destroy-and-recreate, and all four footprint items above should be deleted in
one pass (verify with the issue-41 repro: `example/svelte` counter to 3, edit
the page `<script>`, count must survive — now via the runtime, with no remount
log/behavior).

---
## 5. Bun's native CSS parser doesn't understand Tailwind v4 at-rules

- **Dependency:** Bun (`bun`)
- **Status:** open upstream; **still reproduces on Bun 1.4.2** (re-checked
  2026-10-05 — `@theme`, `@tailwind` and `@utility` each still warn)
  - **oven-sh/bun#12878** — "Bun Bundler: Tailwind CSS" (umbrella, open since
    July 2024): https://github.com/oven-sh/bun/issues/12878
  - Related, open: oven-sh/bun#42909 and #43143 — other valid CSS constructs
    the parser still rejects or mishandles. They show the parser is being
    extended rule by rule; nothing there targets Tailwind's directives.

**Symptom.** When a TS/TSX file `import`s a Tailwind v4 entry CSS (e.g.
`import "./index.css"` where `index.css` contains `@theme {…}` / `@tailwind …`),
Bun's bundler walks the file with its native CSS parser and emits one
`warn: invalid @ rule encountered: '@theme'` (or `'@tailwind'`, `'@source'`,
`'@utility'`, `'@variant'`, `'@custom-variant'`, `'@apply'`, `'@reference'`,
`'@plugin'`, `'@config'`) per unknown at-rule. Build succeeds and styles render
correctly — it's pure noise — but it's loud noise and confuses new users into
thinking Tailwind is broken.

**Root cause.** Bun's CSS parser only understands the standard CSS at-rule
set; it has no knowledge of Tailwind v4's authoring directives. AbsoluteJS
produces the actual Tailwind output via the separate `tailwindcss` `compile()`
pipeline (`src/build/compileTailwind.ts`), so the bundle pass that triggers
the warnings doesn't need to understand the raw directives — but Bun warns
anyway because it sees them in CSS that participates in a build.

**Why local examples never surfaced it.** `examples/stylelab` (which exercises
every styling path including Tailwind v4) keeps its Tailwind entry at
`src/frontend/styles/tailwind.css` — outside any framework directory — and
pulls the **compiled** output in via `<link rel="stylesheet" href="/tailwind.css">`.
Bun's bundler never touches the raw entry. The pattern that surfaces it is
the Vite/CRA-style `src/react/index.css` colocated with the React tree and
imported from a component.

**Workaround in AbsoluteJS.** Filter the known Tailwind v4 directives out of
the central log sink (`src/build/outputLogs.ts`) via
`TAILWIND_BUN_CSS_WARNING_PATTERN` in `src/constants.ts`. Landed in
[`2ff984b`](https://github.com/absolutejs/absolutejs/commit/2ff984b).
Remove the suppression once Bun's CSS parser learns about Tailwind v4 (or
adds a way to silence unknown-at-rule warnings per file).

**Reproduce** (without AbsoluteJS):

```ts
// entry.tsx
import "./test.css";
```
```css
/* test.css */
@theme { --color-primary: #00685b; }
@tailwind base;
```
```ts
const r = await Bun.build({
  entrypoints: ["entry.tsx"], outdir: "out", target: "browser", throw: false
});
// r.logs → [warn] invalid @ rule encountered: '@theme'
//          [warn] invalid @ rule encountered: '@tailwind'
```

---
## 6. Bun escapes non-ASCII text inside `String.raw` tagged templates

- **Dependency:** Bun (`bun`)
- **Status:** open upstream; **still reproduces on Bun 1.4.2** (re-checked
  2026-10-05 — `target: "bun"` escapes, `target: "browser"` keeps the literal)
  - **oven-sh/bun#8745** — "raw tagged template literals show escapes for non
    ascii text" — **open, the canonical issue now**:
    https://github.com/oven-sh/bun/issues/8745
  - oven-sh/bun#16763 — our original link — **closed 2026-08-13 as a duplicate
    of #8745**: https://github.com/oven-sh/bun/issues/16763
  - oven-sh/bun#33867 ("Preserve non-ASCII source text in
    TemplateStringsArray.raw") and #33868 ("transpiler: preserve non-ASCII
    source text at runtime") — the two fix PRs — **both closed unmerged**

**Symptom.** A production SSR build can render different text from its browser
bundle when application source contains a non-ASCII character inside
`String.raw`. For example, a curly quote in inline CSS becomes the six literal
characters `\\u201C` on the server while the browser retains `“`. React then
reports a hydration mismatch even though both bundles came from the same
source.

**Root cause.** Bun's `target: "bun"` transpiler changes a literal Unicode
character in a tagged template into a JavaScript Unicode escape. Tagged
templates expose their source spelling through the template object's `raw`
array, so `String.raw` returns the newly generated escape text. Normal strings
decode the escape and are unaffected. Bun's `target: "browser"` and
`target: "node"` currently preserve the literal character, which is why this
can present as an SSR-only mismatch.

**Workaround in AbsoluteJS.** `src/build/bunStringRawUnicodePlugin.ts` rewrites
only `String.raw` tagged templates with non-ASCII raw segments into the
equivalent ordinary `String.raw({ raw: [...] }, ...substitutions)` call before a
server-targeted Bun build. Ordinary string escaping then preserves the intended
runtime characters while retaining raw backslashes and substitutions. The
plugin is installed on framework SSR, production server, and compiled-server
build passes. `tests/unit/build/bunStringRawUnicodePlugin.test.ts` locks the
runtime behavior against Bun's `target: "bun"` transpiler.

**Remove when:** Bun ships a fix for #8745 and AbsoluteJS's minimum Bun version
includes it. First invert or remove the direct Bun regression assertion, then
remove `bunStringRawUnicodePlugin.ts` and every
`createBunStringRawUnicodePlugin()` registration in the same change.

---

## 7. `new Bun.Transpiler({ reactFastRefresh: true })` ignores the option

- **Dependency:** Bun (`bun`)
- **Status:** open upstream; **still reproduces on Bun 1.4.2** (re-checked
  2026-10-05 — no `$RefreshReg$` / `$RefreshSig$` in the output)
  - **oven-sh/bun#32919** (ours) — **open**:
    https://github.com/oven-sh/bun/issues/32919
  - oven-sh/bun#32951 — the fix — **closed unmerged** as stale.
  - Related, open: oven-sh/bun#42010 — "bundler: one React Fast Refresh
    contract for .jsx and .tsx, add reactFastRefresh.importSource" (an unmerged
    PR touching the same option), and #40179 — "Add a bun --hot flag that runs
    the React Fast Refresh transform". Either could land the transpiler path
    as a side effect; re-run the probe when they move.

**Symptom, root cause and workaround** are in
[docs/REACT_TRANSPILER_BUG.md](./docs/REACT_TRANSPILER_BUG.md). In short:
React edits in `absolute dev` lose component state on stock Bun, so AbsoluteJS
offers [absolutejs/patched-bun](https://github.com/absolutejs/patched-bun)
(Bun plus the backported fix). Its source hunks apply cleanly to Bun 1.4.2;
only the patch's own test hunk needs fresh context.

**Probe** (prints `false` while the bug exists):

```ts
const out = new Bun.Transpiler({ loader: "tsx", reactFastRefresh: true } as never)
  .transformSync("export function C() { const [n] = useState(0); return <b>{n}</b>; }");
console.log(out.includes("$RefreshReg$"));
```

---

## Resolved

### Elysia `status("No Content")` sent a malformed 204 (was #1)

Elysia 1.x put the reason phrase in the body and set `Content-Length: 10` on
a 204, which strict HTTP/2 proxies (Cloudflare) answer with a 504.
**Not present in Elysia 2:** on the wire, 2.0.0-beta.6 and 2.0.0-beta.21 both
send `HTTP/1.1 204 No Content` with no `Content-Length` for `status("No
Content")` (checked 2026-10-05 with a raw socket, since `fetch` hides the
header). elysiajs/elysia#1833 is still open against 1.x and no longer matters
to AbsoluteJS. Numeric `status(204)` remains the clearer spelling.

### Bun had no IPv4 fallback on hosts without IPv6 egress (was #2)

Dual-stack hosts (every `*.googleapis.com`) hung ~25–138 s on DigitalOcean
App Platform, which silently drops IPv6. **Fixed in Bun 1.4.0** by
oven-sh/bun#36295 ("dns: fix RFC 8305 address-family interleave so
blackholed IPv6 doesn't…", merged 2026-07-29, commit `6c04f4b`), which closed
oven-sh/bun#25619 and #29695. The commit is in 1.4.0, 1.4.1 and 1.4.2. Any
app on Bun ≥ 1.4.0 can drop a forced-IPv4 `lookup`; none remain in the
AbsoluteJS repositories. The docker blackhole repro no longer reproduces even
on Bun 1.3.14, so verify by version, not by that repro.
