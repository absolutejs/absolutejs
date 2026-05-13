# Svelte Router — Route Guards (Deferred)

Status: **Not implemented**. Auth checks, paywall checks, and other "should this navigation be allowed?" logic currently live in user code (`{#if user.loggedIn}<Route ... />{/if}`, or a redirect inside the route's snippet). That works but doesn't compose well across many routes and runs *after* the URL has already changed.

## Why we deferred it

The spa-example doesn't have any auth or gating, so guards aren't visible in our reference app. Most users will hit this when their first real app needs a "redirect to /login if not authenticated" path. Until then, the manual workaround is fine.

Bring this back when:

- A user reports needing pre-navigation gating.
- We add server-side data loaders to `<Route>` (likely paired feature — guards run on the server too).
- We add a `<RouterOutlet routes={...} />` config-based API; guards in config form are very natural (each route entry has a `guard` field).

## What "good" looks like

A guard is a function that runs **before** a navigation commits. It can:

- Allow the navigation (return `true` or `void`).
- Deny it (return `false` — the URL doesn't change, the active route doesn't swap).
- Redirect (return a string URL or a typed `redirect()` sentinel — the navigation continues to the redirected URL instead).

Guards must be:

- **Async-aware**: a guard can `await` a session check, fetch a user, etc.
- **Cancellable**: a second navigation that arrives while the first guard is pending should cancel the first.
- **Composable**: guards on parent Routers stack with guards on child Routes.
- **Server-side aware**: during SSR, guards run with the SSR URL. A guard that redirects must signal "render the redirected URL instead" so the initial HTML is correct (no client flash).

The vue-router and react-router-v6.4+ `loader`/`action` story is the closest reference. SvelteKit's `+page.server.ts`'s `redirect(...)` helper is also relevant.

## Proposed API

### Per-Route guard

```svelte
<Route
  path="/dashboard"
  guard={async (page) => {
    const session = await auth.getSession();
    if (!session) return '/login?redirect=/dashboard';
  }}
>
  {#snippet content()}<Dashboard />{/snippet}
</Route>
```

Guard signature:

```ts
type RouteGuard = (page: PageState) => 
  | RouteGuardResult
  | Promise<RouteGuardResult>;

type RouteGuardResult =
  | undefined        // allow
  | true             // allow
  | false            // deny (no navigation, URL unchanged)
  | string           // redirect to this URL
  | { redirect: string; replace?: boolean }; // explicit redirect
```

### Per-Router guard (covers all child Routes)

```svelte
<Router
  guard={(page) => {
    if (page.url.pathname.startsWith('/admin') && !user.isAdmin) {
      return '/login';
    }
  }}
  {url}
>
  ...
</Router>
```

Useful for "all routes under /admin require admin" without repeating the check on every `<Route>`. Router-level guard runs first; if it allows, the Route-level guard runs.

### Helper for typed redirects

```ts
import { redirect } from '@absolutejs/absolute/svelte/router';

guard: (page) => {
  if (!user) throw redirect('/login');
}
```

`redirect()` returns a sentinel object the router recognises. Throwing instead of returning lets users early-exit deeply nested guard helpers without threading the return value back up. Mirrors SvelteKit's `redirect()`.

## Implementation sketch

### Where guards run

In `goto()` (and the popstate listener, and the SSR URL setup):

1. Collect all applicable guards: outer `<Router>`s' guards in order, then the matched `<Route>`'s guard.
2. Run them sequentially (parent → child). Each one can:
   - Return `false` → abort, don't update `page.url`.
   - Return a redirect → recurse `goto(redirect, { replaceState: true })`.
   - Return undefined/true → continue.
3. If all pass, commit the navigation (update `page.url`, run View Transition, etc.).

### Cancellation

Each guard chain runs against a navigation token (incrementing counter). If the token changes while a guard is awaiting, abort the chain — the user has already started another navigation.

```ts
const token = ++currentNavigationToken;
for (const guard of guards) {
  const result = await guard(targetPage);
  if (token !== currentNavigationToken) return; // stale
  // ... handle result
}
```

### Server-side handling

Guards must run during SSR too — otherwise an unauthorised user gets a flash of the protected page on initial load before the client redirects.

In `Router.svelte`'s SSR branch (the `if (isOutermost) { ... seedPage(initial); }` block):

1. Find the matched route.
2. Run all guards.
3. If any returns a redirect, the page handler should respond with a `302` instead of rendering. **This needs framework cooperation** — `Router.svelte` can't return a `Response` from inside Svelte, so we'd need a side-channel.

Two options for the side-channel:

- **Throw a special error** that the Svelte page handler in `src/svelte/pageHandler.ts` catches and converts to a `302`. Cleanest but couples the router and the page handler.
- **Pass a `setRedirect` callback** through props that the page handler installs and the router calls. More explicit but adds a prop users have to remember.

Probably go with the throw approach (option 1) and document it. SvelteKit takes the same shape with its `redirect()` helper throwing.

### Route-level guard SSR sequence

```ts
// inside Router.svelte SSR branch
const winner = computeWinner();
if (winner) {
  for (const guard of collectGuards(winner.id)) {
    const result = await guard(synthesizedPage);
    if (result === false) {
      throw new RouterAbort();
    }
    if (typeof result === 'string') {
      throw new RouterRedirect(result);
    }
    if (result && typeof result === 'object' && 'redirect' in result) {
      throw new RouterRedirect(result.redirect, result.replace);
    }
  }
}
```

The page handler catches `RouterRedirect` and emits `Response.redirect(url, redirect.replace ? 308 : 302)`. Catches `RouterAbort` and renders an empty body / 403 (configurable).

## Test plan

- **Unit**: guard chain runs in order; first false aborts; first redirect short-circuits.
- **Cancellation**: navigation B started during navigation A's pending guard cancels A.
- **Per-Router + per-Route stacking**: outer guard runs before inner.
- **SSR redirect**: an SSR guard returning a redirect causes the page handler to emit a 302 with the right `Location` header.
- **Async guard**: `await`-ing inside a guard works; multiple awaits compose.
- **Throw-based redirect**: `throw redirect('/login')` from deep inside a helper short-circuits the same way as a returned redirect.
- **Integration (in spa-example)**: add a fake auth guard on `/svelte/profile`; assert hitting it without "auth" redirects to `/svelte` and the URL bar reflects that.

## Risks

- **Hydration mismatch**. If the SSR guard's outcome differs from the client's (different session state, expired token), the SSR HTML and client render diverge. Mitigation: document that guard logic must be deterministic given the same `page` input. Most real-world auth uses a cookie that's available on both sides, so this is usually fine.
- **Async guard performance**. Awaiting inside a guard delays every navigation. Mitigation: cache where it makes sense (session check once per page load, not per navigation). Provide a `cache: 'navigation' | 'session'` hint on the guard config to formalise this.
- **Throwing vs returning ambiguity**. Two ways to redirect can confuse users. Mitigation: docs lead with one way (return for top-level, throw for helpers), and the router treats them identically.
- **Guard composition with shallow routing**. `pushState`/`replaceState` are shallow — they shouldn't run guards (no route swap). Skip guards entirely when the active route doesn't change.

## Compatibility

Strict addition. Routes without a `guard` prop behave exactly as today. Safe for a minor bump.
