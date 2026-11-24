# Vue app state across the render boundary

A Vue page's `setupApp` hook runs on both sides, so a project can install
Pinia — or any store — and have it work on each side. What it could not do
is get the **state** across.

```ts
// src/vue/pages/Shop.vue  →  <script lang="ts">
export const setupApp = (app, ctx) => {
	const pinia = createPinia();
	app.use(pinia);

	if (ctx.isServer) ctx.transferState('pinia', () => pinia.state.value);
	else pinia.state.value = ctx.restoredState('pinia') ?? {};
};
```

That is the whole of it.

## What was wrong

Pinia fills its stores during the server render. The browser then creates
a fresh instance, and **every store resets on mount**: the visitor sees
the server's values, then a flash as hydration replaces them with empty
ones, and anything the client refetches is work the server already did.

This is the classic Vue SSR pitfall, and nothing in the framework carried
the state over.

## Why a channel and not Pinia support

AbsoluteJS does not depend on Pinia and should not. Two calls serve any
store a project brings — Pinia, a plain reactive object, something
hand-rolled — and the framework stays out of the choice.

## The snapshot is a function, deliberately

`transferState(key, () => value)` takes a getter, and it is read **after**
the render rather than when it is registered.

A store is empty at `setupApp` time and full once the render has run.
Taking the value at registration would transfer an empty store every
single time — and the feature would look like it worked, which is the
worst kind of wrong.

## Both members exist on both sides

`transferState` is a no-op in the browser and `restoredState` returns
`undefined` on the server, so one isomorphic hook can call either without
branching on `isServer`. The example above branches only because Pinia
wants a different call per side.

## State that cannot be carried

The payload is JSON. A store holding a `Map`, a class instance or a
function cannot travel, and that key is **dropped with an error naming
it** rather than failing the page: by the time this runs the render has
already succeeded, and turning a rendered page into a 500 over one
unserializable key is the wrong trade.

Note that `JSON.stringify` *returns* `undefined` for a function rather
than throwing. Without a check for that, the page would have received
`{"key":undefined}` — not a syntax error, so the transfer would silently
carry nothing and still look like it worked.

## Where it lands

`window.__ABSOLUTE_APP_STATE__`, written after the page's markup and read
before the app mounts. A page that transfers nothing writes no script at
all.

## Scope

Pages. A Vue **island** has no `setupApp` hook — it is a component, not an
app — so this does not apply to one. An island that needs server data has
`useServerData`, which prefetches on the server for islands too (see
`docs/` and the `useServerData` reference).
