# Form actions — plan

Status: Phase 1 implemented (server, no-JS, React, static HTML, HTMX). Phases 2–4 below.

ROADMAP.md §3 ("P1 — Form Actions with Progressive Enhancement") asks for one action model that works from any framework's page, with forms that work without JavaScript and enhance when it's present.

## Where things stood

- Forms posted to hand-written Elysia routes. Nothing turned validation errors into per-field messages, nothing brought a no-JS submission back to the page it came from, and every framework needed its own fetch code.
- Pieces we build on:
  - Elysia route schemas: `t.Object` bodies give validation plus Eden types.
  - The request context: `getCurrentAbsoluteRequest()` (AsyncLocalStorage, `src/core/requestContext.ts`). It lets a page route read per-request state without threading `request` through.
  - The CSP nonce (`src/core/cspNonce.ts`, `src/plugins/secureHeaders.ts`). Its default policy already sends `form-action 'self'`.
  - Bun's `HTMLRewriter`, already used for streaming HTML transforms.
- HTMX pages could already `hx-post`, but nothing tied that to a typed handler, and a no-JS fallback on an HTMX page meant writing a second route.

## Design

### Definition

```ts
// actions.ts (server)
export const createUser = defineAction('/users', {
	body: t.Object({
		email: t.String({ error: 'Enter a valid email', format: 'email' }),
		name: t.String({ minLength: 2 })
	}),
	handler: async ({ body, fail, context }) => {
		if (await db.userExists(body.email)) return fail({ email: 'Already registered' });
		return { id: await db.insertUser(body) };
	},
	redirect: (data) => `/users/${data.id}` // optional; default: back to the form's page
});

app.use(createUser); // a plain Elysia plugin
```

- `defineAction(path, options)` returns an Elysia instance with one `.post(path, { body, parse, transform, error, beforeHandle }, handler)` route, plus a phantom `actionPath` / `'~formAction'` type. So `app.use(action)` mounts it, and Eden sees the route with its body schema (verified: `treaty<typeof server>().actions.signup.post({ name })` fails to typecheck when `email` is missing).
- The body schema is the route's real Elysia schema, so Elysia validates and coerces it. The route's `error` hook turns a body `ValidationError` into one message per field:
  - The key is the top-level field name, or a dotted path for nested fields.
  - The message is the property's `error` option when it is a string, `Required` for missing fields, and the validator's message otherwise.
  - In production, Elysia reports only the first issue once any property has a custom `error`. So on failure, and only then, the body is re-checked with TypeBox `Value.Errors` (the same TypeBox Elysia uses, now external in the build) to collect every field's error. Elysia's own list is the fallback.
- Browser forms send strings. A `transform` hook maps them onto the schema before validation:
  - An unchecked checkbox becomes `false`, and `on`/`true`/`1` become `true`.
  - `''` in a number field means not given. A numeric string becomes a number.
  - A single value for an array field becomes `[value]`, and a missing one becomes `[]`.
  - An empty file input is dropped.
  - Only top-level fields are mapped.
- The handler returns data on success. It returns `fail(errors, message?)` for errors it finds itself (`errors` keys are typed to the schema's fields), or a raw `Response` as an escape hatch.
- Types: `ActionStateOf<typeof createUser>` is `idle | { status: 'success'; data?: Data; redirect? } | { status: 'error'; errors: Partial<Record<Field, string>>; message?; values? }`. Browser code gets this through `import type`, so server code never enters a client bundle.

### One handler, three kinds of caller

| Caller | How it's recognised | Answer |
| --- | --- | --- |
| Plain `<form method="post">` (no JS) | anything else (form content type, HTML `Accept`) | `303` to `redirect` on success, else back to the page (same-origin `Referer`, else `/`). The result rides in a cookie. |
| Browser helpers | `x-absolute-action` header | JSON result, always `200`, so an invalid form doesn't log a console error |
| Other JSON clients (Eden, fetch) | JSON content type, or an `Accept` that wants JSON and not HTML | JSON result, `422` on error |
| HTMX | `HX-Request: true` | The action's `htmx(result)` fragment (`200`, so HTMX swaps it), or `HX-Redirect` plus the cookie (same as no-JS) when there is no fragment |

### Without JavaScript: Post/Redirect/Get with a one-shot result cookie

- **The cookie.** On a no-JS post the result goes into `absolute_action`: base64url JSON of `{ action, result }`.
  - Attributes: `HttpOnly; SameSite=Lax; Path=/; Max-Age=60`, plus `Secure` on https.
  - For errors it carries what the user typed, but never files or secret-looking fields (`password`, `token`, `card`, `cvc`…). `preserveValues: false` turns the echo off entirely.
  - It is shrunk to fit about 3.5 KB: values go first, then data, then everything but the outcome.
- **Why a cookie rather than rendering in the POST response.** Without a file router the action URL is not the page URL, so rendering in place would leave the action URL in the address bar, and a reload would re-POST or 404. PRG keeps the page's URL, and a reload is a clean GET.
- **SSR pages (React now, the other frameworks in Phase 2).** The route reads `getActionState(createUser)` (the request comes from the request context) and passes it as a prop. `useFormAction(path, { initialState })` renders the errors and `values`. The state is part of the props, so hydration matches.
- **Static HTML and HTMX pages** can't run code on the server. `formActionRuntime()` handles them instead:
  - It is mounted inside the `absolutejs` plugin from `prepare()`, so it reaches every page route without any ordering requirement. That was the one shared-file change in `prepare.ts`: 3 × `.use(formActionRuntime())`.
  - It is a global `mapResponse` hook. For a `GET` whose HTML response arrives while the cookie is set, it rewrites the `<form data-absolute-action>` whose `action` matches, using `HTMLRewriter`, streaming:
    - each `[data-action-error="field"]` gets its message and loses `hidden`;
    - `[data-action-message]` gets the form-level message;
    - `[data-action-success]` loses `hidden` on success;
    - the form gets `data-action-status`;
    - fields get `aria-invalid`;
    - `input` / `textarea` / `select` / checkbox / radio get the typed values back (hidden, password and file inputs never do).
  - Forms without the attribute (React's `useFormAction` forms) are left alone, so there is no hydration mismatch.
- **One-shot.** The first HTML page served while the cookie is set clears it (`Max-Age=0`) and is sent `Cache-Control: no-store` without its ETag, so one user's result is never cached or revalidated as the page. Non-HTML responses (assets, JSON) leave the cookie alone.
- **Trust.** The cookie is unsigned. Only the user's own browser sets it, through the 303 from a same-origin post, and it holds display text that every framework escapes (`HTMLRewriter` escapes `setInnerContent` and `setAttribute`). A forged cookie can only change what that user sees. Signing it is listed under Phase 3.

### With JavaScript

- **React** (`@absolutejs/absolute/react/hooks`): `useFormAction<typeof createUser>('/actions/signup', { initialState, resetOnSuccess })`.
  - It returns `{ formProps, state, pending, errors, values, data, message, submit, reset }`.
  - `formProps` is a real `{ action, method: 'post', encType: 'multipart/form-data', onSubmit }`, so the form works before hydration and with JS off.
  - Once hydrated, `onSubmit` sends `FormData` (including the submitter) with fetch. A newer submission aborts the older one, and unmount aborts too.
  - Errors keep the fields as typed. Success resets the form unless it redirects, and a `redirect` navigates.
  - The path is type-checked: `ActionPath<typeof createUser>` is the literal path.
- **React 19 `useActionState` compatibility:** `formActionReducer<typeof createUser>(path)` is a `(prevState, formData) => Promise<ActionResult>`, so `useActionState(formActionReducer(path), initial)` works.
  - It is JavaScript-only: React SSR renders a function `action` as a `javascript:` URL without RSC.
  - The section on React Server Actions below covers how the two relate.
- **Plain pages** (`@absolutejs/absolute/client`): `enhanceForms(root?)` / `enhanceForm(form)`.
  - It upgrades `<form data-absolute-action>` to fetch, toggles `aria-busy`, `data-action-pending` and disabled submit buttons, and applies the result with the same DOM conventions the server rewriter uses (`applyActionResult`, exported).
  - It focuses the first invalid field, fires `absolute:form-action` with `{ result }`, and resets the form or follows `redirect` on success.
  - It skips `hx-post` forms.
- **HTMX:** `hx-post` + `hx-target` posts with `HX-Request`, and the action's `htmx(result)` fragment is swapped in. The same form keeps `method`/`action`/`data-absolute-action` for the no-JS path.
- `submitFormAction<typeof action>(path, formData, { signal })` is the framework-free primitive the above share. Network or unexpected server failures come back as `{ status: 'error', errors: {}, message }`.

### Security

- **Cross-origin protection (Phase 1, on by default).**
  - The rule, the same one Go 1.25 uses in `http.CrossOriginProtection`:
    - an `Origin` listed in `csrf.trustedOrigins` passes;
    - otherwise `Sec-Fetch-Site` must be `same-origin` or `none`;
    - if the browser didn't send it, `Origin` must match `Host`;
    - requests with neither header (curl, server-to-server, very old browsers) pass.
  - Failures get `403` before the body is read: the `parse` hook records the rejection and skips parsing, and `transform` throws it into the route's error hook.
  - A cross-site page therefore can't even set a victim's result cookie. `csrf: false` turns the check off for actions meant to be called from other sites.
- **CSRF tokens (Phase 3).** Synchronizer tokens for deployments that must cover browsers which send neither header, or that have a same-site but untrusted subdomain.
  - The token would be a signed double-submit: an `absolute_csrf` cookie, plus a hidden `_csrf` field or `x-absolute-csrf` header holding an HMAC of the cookie.
  - The renderer would get it the same way the CSP nonce reaches renderers: `getCsrfToken()` reads the current request through `getCurrentAbsoluteRequest()` and mints it on first use, as `getCspNonce()` does. A `csrfField()` helper per framework, and `formProps` in the hook, would include it automatically.
  - Prerendered pages can't embed a per-user token, so there `enhanceForms` / `useFormAction` would read the cookie and send the header. That is why the cookie is not HttpOnly.
  - `secureHeaders()` already sends `form-action 'self'`. The browser helpers emit no inline scripts. Any future inline bootstrap must use `nonceAttr()` (`src/utils/cspNonceRef.ts`).
- **Auth.**
  - `beforeHandle` passes straight through to the route, so it runs after validation and can return `status(401)` or a redirect.
  - The handler gets the full Elysia `context`, untyped in Phase 1, so derived values such as `user` are reachable.
  - Phase 2 adds `defineActions(app)` to bind actions to an app or guard instance, so the handler context inherits `derive` / `resolve` types and guard hooks.
- **Size limits.**
  - `maxBodySize` defaults to 10 MiB. A request whose declared `Content-Length` exceeds it gets `413` before its body is read.
  - Chunked bodies without a length fall back to Bun's server-wide `maxRequestBodySize`. Phase 3 adds a streaming byte counter.
- **File uploads.** `t.File()` / `t.Files()` work in both paths: the hook always posts `multipart/form-data`, and plain forms need `enctype="multipart/form-data"`. Empty file inputs are dropped before validation, and files are never echoed back.
- **Open redirects.** The "back" target only comes from a same-origin `Referer` / `HX-Current-URL`, else `/`. `redirect` is developer-supplied.

### Interop

- **File router (designed in parallel).**
  - Co-located actions: a page module exports `actions = { default: defineAction(...), delete: defineAction(...) }` or `export const action = ...`.
  - The router mounts each one at the page's own path: `POST /signup` for `default`, `POST /signup?/delete` for a named action, as in SvelteKit.
  - With the action at the page URL, the no-JS path can render the page directly in the POST response (status 422 on error), with no cookie. The router supplies `getActionState` from the in-flight result instead of the cookie, so page code is the same either way.
  - `defineAction` already takes the path as data, so the router only needs a `pathFor(page, name)` and the existing plugin.
  - Agreed contract for the router agent: actions are `FormActionDefinition` values, mounted via `.use()`, and the router must not mount its own POST handler at a page path that has actions.
- **Prerendered / ISR pages.** A prerendered page is served by the prerender plugin's `onRequest`, before the result renders.
  - With JS the helpers work unchanged.
  - Without JS, Phase 2 makes the prerender plugin skip the cached file when the `absolute_action` cookie is present, so the live handler renders the result. That is a one-line check in `prepare.ts`.
  - The response is already `no-store`, so it never poisons the prerender or ISR cache.
- **Streaming.** Results are known before render begins, so a streamed page gets them as props.
  - The HTML rewriter is streaming (`HTMLRewriter.transform`), so static pages keep their streaming slots.
  - Streaming-slot patches are separate inline scripts that the rewriter doesn't touch. A form inside a streamed slot isn't rewritten without JS (documented limitation).
- **React Server Actions (designed in parallel).** RSC server actions (`'use server'` functions, `<form action={fn}>`, `useActionState(fn, init, permalink)`) are a separate mechanism with a different transport (the RSC action ID protocol).
  - To avoid collisions, form actions own the names `defineAction`, `getActionState`, `useFormAction`, `submitFormAction`, `formActionReducer`, `enhanceForms`, the `x-absolute-action` header and the `absolute_action` cookie.
  - The RSC work should use `serverAction` / `'use server'` naming and its own header (for example `Next-Action`-style `x-absolute-rsc-action`).
  - Where they meet: Phase 4 lets `defineAction` produce a server-action-compatible function for RSC pages, wrapping the same handler and validation. RSC `useActionState` with a permalink then gets the same no-JS behaviour, and one handler serves both. Until then they coexist: RSC pages use server actions, every other page uses form actions.

## Phases

### Phase 1 (done): server, no-JS, React, static HTML, HTMX

- Implemented:
  - `defineAction` with Elysia schemas, typed field errors, `fail`, `redirect`, `htmx`, `beforeHandle`, `csrf`, `maxBodySize` and `preserveValues`;
  - `getActionState`;
  - `formActionRuntime` (mounted by `prepare()`);
  - `submitFormAction`, `formActionReducer`, `enhanceForm(s)` and `applyActionResult`;
  - React `useFormAction`;
  - types in `types/formAction.ts`.
- Exit criteria, all met:
  - Unit: 17 tests (`tests/unit/core/formActions.test.ts`) over JSON, no-JS, HTMX and protection, including type-level checks.
  - Browser: 8 tests (`tests/integration/server/form-actions.test.ts`) in a production build with `secureHeaders()`:
    - React, HTML and HTMX pages, each with JavaScript on and off (Playwright `javaScriptEnabled: false`);
    - no reload with JS;
    - no CSP violations;
    - the cross-site 403;
    - a JSON client.
  - Packed-tarball E2E: a scaffolded app (create-absolutejs, React+Svelte+Vue+HTML+HTMX), with the tarball installed:
    - 27/27 browser checks under both `absolute build` + `start` (production) and `absolute dev`;
    - the app typechecks, including the Eden check that a missing `email` field fails.

### Phase 2: Svelte, Vue, Angular, auth binding, prerender

- Svelte: `formAction(path)` returning a store `{ state, pending, errors, values }` plus `use:enhance`. Vue: `useFormAction` composable returning refs and `formProps`. Angular: `[absoluteAction]` directive plus `FormActionService` (signals). All three are thin wrappers over `submitFormAction` and `applyActionResult`.
- `getActionState` documented for each framework's props path (Svelte/Vue/Angular handlers already take props).
- `defineActions(app)` binder for typed derive/guard context.
- Prerender bypass when the result cookie is present.
- Exit: the Phase 1 browser matrix extended to Svelte, Vue and Angular pages, JS on and off, in dev and production.

### Phase 3: hardening

- Signed CSRF tokens (`getCsrfToken`, `csrfField`, automatic in the helpers) as an opt-in `csrf: { token: true }`.
- A signed result cookie.
- Streaming byte limits for chunked bodies.
- Nested-object and array-of-object field paths (`address.city`, `items[0].qty`) in normalisation and value echo.
- Optimistic updates (`optimistic(formData)` in the hook).
- Exit:
  - token mode passes the matrix with `Sec-Fetch-Site` stripped by a proxy;
  - fuzzed cookies never break rendering;
  - an oversized chunked upload gets 413.

### Phase 4: file router and RSC convergence

- Co-located page actions mounted by the file router at the page URL, with in-place no-JS rendering.
- An RSC server-action adapter so one handler serves both.
- Exit: the same signup form defined once works on an RSC page and a non-RSC page, with JS on and off.

## Known limitations (Phase 1)

- Values are echoed only for top-level fields, and nested schemas validate but aren't normalised.
- A form inside a streaming slot isn't rewritten without JS.
- Prerendered pages show no-JS results only after the Phase 2 bypass.
- The handler's `context` is untyped.
- The result cookie is unsigned (see Trust above).
