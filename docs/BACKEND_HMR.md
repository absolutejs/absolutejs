# Backend hot module replacement

Editing server code in `absolute dev` updates the running server in place, in
milliseconds, without re-running anything that did not change. The process,
its port, open requests, WebSockets, database pools, queues and in-memory
state all carry across the edit.

## Why not restart, and why not re-run the module chain

A full restart rebuilds every page and drops every connection (~10 s on a
large app). Re-running the edited module and everything that imports it, up
to the server entry, is what Vite-style SSR HMR does — but the entry of a
real app creates database pools, queue workers, change-data-capture
listeners, cron schedules and intervals, and may call paid APIs at boot. Re-
running it on every save duplicates all of that; in a large app one edit can
re-run hundreds of modules through a single import cycle.

So the unit of change is the top-level statement, not the module.

## How it works

Every app source module the server loads (not packages, not framework page
sources, not build output) is served through a Bun runtime plugin as two
modules:

- **The facade** (`path`) is what importers get. Each exported function is a
  hoisted forwarding function that calls the module's *latest* version, so a
  route closure created at boot calls new code after an edit. Other exports
  (values, classes) are live bindings the runtime reassigns when they change.
- **The implementation** (`path?absolute-hot=N`) is the module's own code,
  rewritten so that each top-level statement remembers its result:
  - `const`/`class` declarations and `export default` expressions are kept:
    when a new version evaluates, an unchanged declaration returns the value
    the previous version created instead of evaluating again;
  - side-effecting statements (`startQueue(...)`, `setInterval(...)`) run
    again only if they changed;
  - top-level `let`/`var` live in a per-module store that survives versions,
    so state assigned at runtime (`store = createStore()`) is not reset.

"Unchanged" means: the statement's text, the text of every top-level
declaration of the same module it reaches (directly, or through functions it
references), and the content of any imported binding it *uses while the
module evaluates* (a call such as `plugin(db)`, or a captured value) are all
the same as last time. Imported functions merely referenced, or called later
from a request, are not dependencies: the facade's forwarder is stable.

## Applying an edit

1. The changed file's new source is analysed. If its exports keep the same
   names and kinds, its next version is imported (`?absolute-hot=N+1`); only
   changed statements re-run. If exports were added, removed or changed kind,
   the facade is regenerated for later importers.
2. Exports whose content changed get a new content hash.
3. Each loaded module that imports the file is checked: if one of its
   statements used a changed export while evaluating (for example the entry's
   `new Elysia().use(usageAnalyticsPlugin(db))`), that module's next version
   is imported too — and again only the affected statements re-run. This
   repeats up the import graph.
4. If the entry re-ran the statement that builds the app, `networking()` swaps
   the live `Bun.serve` handler, runs the old app's Elysia `cleanup` hooks and
   the new app's `setup` hooks.

A typical handler edit re-runs one module and nothing else.

## What re-running a statement stops first

Everything a statement started while it ran — and everything its async work
and timer callbacks started — is attributed to it: intervals, timeouts and
self-rescheduling timer chains (cron libraries), `process` listeners, extra
`Bun.serve` servers (a fixed port is handed over), workers, `onHotDispose`
callbacks and values implementing `Symbol.dispose` / `Symbol.asyncDispose`.
When the statement re-runs successfully, what its previous run started is
stopped. If the new version throws, what it started is stopped instead and
the previous version keeps serving.

Work done while serving a request or a WebSocket event is never stopped: it
belongs to that request (an SSE keepalive, a live call) and finishes on the
code that started it.

## Escape hatches

- `onHotDispose(fn)` — run `fn` when the statement that registered it is
  replaced (close something the runtime cannot see).
- Saving a config file (`.env`, `package.json`, `tsconfig.json`) or a module
  the hot runtime does not manage still restarts the server.

## Limits

- `export let` bindings re-exported live from a module are not swapped; a
  change to such a module re-runs its importers' affected statements.
- A value created *before* an edit keeps the behaviour of the code that
  created it (an object built by an old factory). Statements that built it
  re-run when the factory's content changes, so this only shows for values
  created at request time.
- Sockets and connection pools are not closed for you: when the statement
  that created a pool re-runs, close the old one with `onHotDispose` (or give
  it `Symbol.asyncDispose`). Statements that only *use* the pool keep it.
- A timer a library starts on a shared object (a pool's idle timeout set
  while a query runs) belongs to whichever statement made that call. If that
  statement re-runs, the timer is cleared, so that timeout simply never
  fires.
- Requires TypeScript (an optional peer) to analyse modules. Without it, edits
  to server code restart the server.
