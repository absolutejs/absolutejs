# The server/client boundary

Three ways server-side values used to travel somewhere they should not,
and what stops each now.

| Path | What stops it |
| --- | --- |
| A server module imported, directly or transitively, by client code | `import '@absolutejs/absolute/server-only'` — a build error in the pass that resolved it |
| `process.env.X` read in client code | A build error naming the file and line (`clientBoundary.processEnv`) |
| A secret's value handed to a page as a prop | `serializeInitialProps` refuses the payload (`src/utils/serverSecrets.ts`) |

The first two are enforced by `src/build/clientServerBoundary.ts`, which
runs as two Bun plugins on every browser bundling pass — the React client
pass, the non-React client pass, the worker pass and the islands pass — and
on none of the server passes.

## Marking a module server-only

```ts
// src/lib/db.ts
import '@absolutejs/absolute/server-only';

import { Database } from 'bun:sqlite';

export const db = new Database(getEnv('DATABASE_PATH'));
```

Any browser bundle that reaches this module fails the build:

```
[absolutejs] src/lib/db.ts imports "@absolutejs/absolute/server-only", so it
must not be part of a browser bundle — but a client bundling pass resolved
it. Follow the imports from your page's client entry to that module: move the
server-only work into a route handler or a form action, and pass what the
page needs through its props.
```

The message names the file that holds the import, because that is the file
to edit. Finding *why* it is in the bundle means following the imports back
from the page's client entry — usually a barrel file (`index.ts`) that
re-exports both halves of a module, or a type-only import written without
`import type`.

The bare specifier `server-only`, which Next.js uses for the same idea, is
intercepted too, so a project moving over gets this message rather than
"Could not resolve".

When the import is in a **dependency**, the message names the package and
says so instead, because that is the package's own server/client split
rather than something to refactor in your code.

There is no `client-only` counterpart yet.

### Why the marker also throws

`src/serverOnly.ts` throws if it is ever evaluated somewhere with a
`document` or a `window`. The build error is the real mechanism; the throw
covers the paths the bundler is not on — chiefly the dev module server,
which transpiles per file and serves unbundled ESM, so a module reached
only at runtime never passes through a client pass.

## `process.env` in client code

Bun does **not** inline `process.env.X` into a browser bundle. Nothing
leaks: the reference survives verbatim, and the browser throws

```
ReferenceError: process is not defined
```

when the module evaluates — so a `NEXT_PUBLIC_`-style prefix convention
would have guarded nothing that was not already safe. What was missing was
being told before a visitor's browser was the one to find out.

```
[absolutejs] src/components/Clock.tsx reads process.env in client code:
process.env.API_URL (12:20). Bun does not inline it into a browser bundle, so
the reference survives and throws "ReferenceError: process is not defined"
when the module evaluates. Read the value on the server and pass it through
the page's props, or test for it with `typeof process !== 'undefined'`.
```

### What is allowed

- **`process.env.NODE_ENV`.** Bun substitutes it in every browser bundle
  whether or not the pass defines one (see `src/build/resolveBuildMode.ts`),
  so it neither crashes nor leaks. A project that picks a code path by it
  keeps working.
- **Any key the pass's `define` substitutes**, including one you add through
  `bunBuild.define`.
- **A read tested with `typeof process`**, in any enclosing `if`, ternary,
  `&&`, `||` or `??`:

  ```ts
  const region = typeof process !== 'undefined' ? process.env.REGION : '';
  ```

  An early return counts too, which is how the guard is most often
  written:

  ```ts
  const secrets = () => {
  	if (typeof process === 'undefined') return [];

  	return Object.entries(process.env).filter(isSensitive);
  };
  ```

  The `if` must have no `else`, its branch must `return` or `throw`, and it
  must come before the read. A bare `typeof process` elsewhere in the file
  guards nothing and is not accepted, and neither is an `if` whose branch
  falls through.
- **Dependencies.** A file under `node_modules` is skipped — its
  `process.env` is not the project author's to fix, and third-party code
  guards or substitutes it as a matter of course.

References are found by parsing, not by matching text, so the string
`"process.env.API_URL"`, a comment and a template literal are not
references. (The repo has already shipped one bug from a text scan that
could not tell the difference; see `src/build/maskLiterals.ts`.) A file
whose source never contains `process.env` is not parsed at all, which is
what keeps the parser off nearly every module in a build.

### Configuration

```ts
// absolute.config.ts
export default defineConfig({
	clientBoundary: { processEnv: 'warn' }
});
```

| Value | Effect |
| --- | --- |
| `'error'` | Fails the build. The default for `absolute build`. |
| `'warn'` | Logs the file, key and line; the build succeeds. The default under `absolute dev`. |
| `'off'` | No check. |

The default is keyed on the dev server (`options.injectHMR`), not on the
resolved development mode, so `absolute build` fails hard whatever the
ambient `NODE_ENV` says.

The default differs by command on purpose. In production a hard failure is
what keeps a broken page from shipping. In dev, a plugin error fails its
whole bundling pass, which would take down every page in that pass rather
than the one module at fault — a worse trade than the runtime error the
check exists to pre-empt. `absolute build`, and so CI, and so anything
about to be deployed, still fails hard.

The server-only marker is not configurable: shipping a module that declares
itself server-only to a browser is always an error.

## A note on symlinked project roots

Both checks compare module paths against the project root's **real** path.
Bun hands a plugin the resolved path of each module, so a project reached
through a symlink — macOS's `/var` for `/private/var`, a linked workspace
package — would otherwise look as though it sat outside itself, and every
file would be skipped. A check that silently does nothing is the failure
mode most worth engineering against; three tests in
`tests/unit/build/clientServerBoundary.test.ts` fail without that
resolution.

## What it found first

On this repo's own example build, the first run of the `process.env` check
failed on `dist/vue/browser.js`:

```
dist/vue/browser.js reads process.env in client code: process.env (77:29)
```

The chain was `client/preserveIslandMarkup.ts` →
`core/islandMarkupAttributes.ts` → `serializeIslandProps` →
`assertNoServerSecrets` → `Object.entries(process.env)`. An island
re-derives its own marker attributes in the browser to find the element it
hydrates into, so the props guard added in 0.20.0-beta.225 had been
throwing `ReferenceError: process is not defined` there and the island
never hydrated. `src/utils/serverSecrets.ts` now reads the environment only
where there is one, and
`tests/unit/utils/serverSecrets.test.ts` asserts that through a real
browser bundle — including that removing the guard makes the same bundle
throw, so the test cannot pass for another reason.

Worth stating plainly: the framework's own `dist/` is scanned here only
because a dev install symlinks `@absolutejs/absolute` into the repo, which
puts it under the project root rather than under `node_modules`. In a real
project that code is a dependency and is skipped. Keeping the repo's own
example build inside the check is therefore deliberate — it is the one
place this class of bug in the framework's browser entries gets caught.

## Tests

- `tests/unit/build/clientServerBoundary.test.ts` — the detector (keys,
  guards, exemptions, what is not a reference) and both plugins through a
  real browser-target `Bun.build`.
- `tests/integration/build/server-client-boundary.test.ts` — the same two
  failures through a real `build()`, which is what makes them build errors
  rather than plugin behaviour.
