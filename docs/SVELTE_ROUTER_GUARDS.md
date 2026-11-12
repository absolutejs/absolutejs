# Svelte Router — Route Guards

Status: **Shipped.** A guard is a function that runs **before** a navigation commits and decides whether it happens. Guards run in the browser for `<Link>` clicks, `goto()` and back/forward, and during the server render, where a redirect becomes a real `302`.

## API

### Where guards go

| Guard | Runs in the browser | Runs on the server | Scope |
| --- | --- | --- | --- |
| `<Route guard={…}>` | yes | yes | navigations onto that route |
| `<Router guard={…}>` | yes | yes | the outermost router: every navigation; a nested router: navigations onto one of its routes |
| `beforeNavigate(fn)` | yes | no | every client-side navigation |

For one navigation they run in this order, and the first guard that cancels or redirects decides:

1. `beforeNavigate` guards, in registration order
2. each mounted `<Router guard>`, outermost first
3. the matched `<Route guard>` of each router

```svelte
<script lang="ts">
	import Router from '@absolutejs/absolute/svelte/router/Router.svelte';
	import Route from '@absolutejs/absolute/svelte/router/Route.svelte';
	import { beforeNavigate, redirect } from '@absolutejs/absolute/svelte/router';

	let { url }: { url?: string } = $props();

	// Browser only. Called during component initialisation, it is removed
	// when the component is destroyed; otherwise call the function it returns.
	beforeNavigate(({ type }) => {
		if (type === 'popstate' && editor.dirty) return false;
	});
</script>

<Router
	{url}
	guard={({ to }) => {
		if (to.pathname.startsWith('/app/admin') && !session.isAdmin) return '/app/login';
	}}
>
	<Route
		path="/app/dashboard"
		guard={async ({ request }) => {
			const user = await loadUser(request); // request: server render only
			if (!user) throw redirect('/app/login?next=/app/dashboard');
		}}
	>
		{#snippet content()}<Dashboard />{/snippet}
	</Route>
</Router>
```

### Signature

```ts
type RouteGuard = (navigation: NavigationContext) =>
	RouteGuardResult | Promise<RouteGuardResult>;

type NavigationContext = {
	from: URL | null;           // null on the first render ('enter')
	to: URL;                    // in hash mode, to.pathname is the routed path
	params: Record<string, string | undefined>; // the guard's route, matched against `to`
	type: 'link' | 'goto' | 'popstate' | 'enter';
	request: Request | undefined; // the incoming request, server render only
};

type RouteGuardResult =
	| undefined | void | true   // allow
	| false                    // cancel
	| string                   // redirect there
	| { redirect: string; replace?: boolean };
```

`redirect(location, { replace })` returns a `NavigationRedirect` (an `Error` subclass that is also a `{ redirect, replace }`), so it can be returned or **thrown** from a helper deep inside a guard; both short-circuit the chain the same way. Any other error a guard throws rejects the navigation (`goto()` rejects; a `<Link>` logs it).

`goto()` resolves to what happened: `'committed'`, `'cancelled'`, `'redirected'`, `'superseded'` (a newer navigation started while a guard was pending) or `'external'`.

## Behaviour

- **Async and cancellable.** Guards are awaited one after another. Each navigation takes a token; when a newer navigation starts while a guard is pending, the older one is abandoned (`'superseded'`).
- **Cancel on a `<Link>` / `goto()`**: nothing changes — no history entry, no route swap.
- **Cancel on back/forward**: the browser has already moved, so the router undoes it with `history.go(-delta)` (every entry the router writes records its index in `history.state`). Entries it didn't write fall back to pushing the previous URL again.
- **Redirect**: navigates to the target instead, adding a history entry unless `replace: true` (a redirect from back/forward or the first render always replaces). Redirects chain; more than 10 in a row throws.
- **Fragment-only changes** (same path and query, different `#hash`) don't run guards, and neither does shallow routing (`pushState` / `replaceState`).

### Server render

The page handler passes per-request router state to the render through Svelte context. Svelte's server render is synchronous, so after the first pass each `<Router>` runs its guard chain (`type: 'enter'`, `from: null`, `request` set) against the request URL, before any second pass:

- a redirect ends the request with `302` and `Location: <target>` (same-origin targets are written as a path; in hash mode the target becomes `/#/target`);
- a cancel ends it with `403 Forbidden`;
- otherwise rendering continues.

`beforeNavigate` guards never run on the server. Put checks the server must enforce on `<Route guard>` / `<Router guard>`.

In hash mode the server never sees the hash, so the router also runs the Route/Router guards once in the browser on the first render; a redirect replaces the entry, and a cancel is ignored there because there is no previous page to stay on.

### Hydration

Make guard logic deterministic for the same input. If the server allows a URL that the browser's guard state would redirect, the server HTML is still what hydrates; the guard only runs again on the next navigation.

## Not covered

- Guards of routes inside a nested `<Router>` that isn't mounted yet (the target page's nested routes register only once they render). Put such checks on the outer route or router.
- A `cache` hint for guard results. Cache in your own guard (for example a session lookup once per page load).

## Tests

- `tests/unit/svelte/router/guards.test.ts` — order, cancel, string / object / thrown `redirect()`, async params, staleness, error propagation.
- `tests/unit/svelte/routerSsr.test.ts` — server outcome → 302 / 403, first decision wins.
- `tests/integration/build/svelte-router-browser.test.ts` — a direct request to a guarded route is a 302; a `<Link>` click is redirected; a `beforeNavigate` that cancels back keeps the URL and the route.
