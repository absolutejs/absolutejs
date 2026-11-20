# Form actions — plan

Status: Phase 1 implemented (server, no-JS, React, static HTML, HTMX), declared as a `form` schema on a normal route since the API review (the proposal in PR #116). Phases 2–4 below.

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

### Declaration: a `form` schema on a normal route

```ts
// server.ts
const { absolutejs, manifest } = await prepare();

export const server = new Elysia()
	.use(absolutejs) // brings the `form` route option
	.use(auth) // derives `user`, like any app
	.post(
		'/actions/signup',
		{
			form: t.Object({
				email: t.String({ error: 'Enter a valid email', format: 'email' }),
				name: t.String({ minLength: 2 })
			})
		},
		async ({ body, fail, user }) => {
			if (await db.userExists(body.email)) return fail({ email: 'Already registered' });
			return { id: await db.insertUser(body, user) };
		}
	)
	.post(
		'/actions/contact',
		{
			form: {
				body: t.Object({ message: t.String({ minLength: 5 }) }),
				redirect: '/thanks', // or (data) => string; default: back to the form's page
				htmx: (result) => '<p>…</p>', // HTMX fragment, optional
				csrf: { trustedOrigins: ['https://admin.example'] }, // or false
				maxBodySize: 1024 * 1024,
				preserveValues: false
			}
		},
		({ body }) => ({ sent: true })
	);
```

- `form` is an Elysia macro, `formActions()` in `src/core/formActions.ts`. The `absolutejs` plugin from `prepare()` includes it (its type is `FormActionsPlugin`, the macro and nothing else, so internal routes stay out of the app's route type), so apps add no `.use`. A plain Elysia app adds `.use(formActions())`, which also brings `formActionRuntime()`.
- An action is a route in the app's chain, so guards, `derive`, `resolve`, groups and prefixes apply as they do to `.get`, with their types: `user` above is typed from `auth`. There is no second way to declare a route.
- `form` takes the schema alone, or `{ body: schema, …options }` when options are needed. The macro tells them apart at runtime by the schema's `type: 'object'` + `properties`, and at the type level by the `body` key (`FormActionSchemaOf`). That type reads the value through `keyof` and `Value['body']`, never an object pattern (`Value extends { body: infer S }`). A hook in the same route object may have a callback that reads the context (`beforeHandle: ({ user }) => …`). TypeScript then resolves the macro's types while it is still inferring that object, and an object pattern against an inline `{ body, redirect, … }` resolves to its false branch: `body` became `never` and `fail` took any field.
- The macro's type lambda (`FormActionMacroType`, `$type: macroType<…>()`) types the route from the `form` value: `body` from the schema, `fail` keyed by its fields (a typo'd field is a compile error), and the 422 response as the field-error shape (`FormActionFailure`). The lambda only sees the macro's value (`this['input']`), not the route's context, which is why the schema is the macro's value rather than `body` plus a flag. The runtime `fail` is typed `{}` inside `derive` so only the lambda's typed one applies, and the lambda's output is a named type (`FormActionContext`) because `this` can't appear in a nested type literal.
- Eden sees the route like any other: `body` from the schema, the handler's data as the 200 and `{ errors, message?, status: 'error' }` as the 422. The lambda's `response` replaces Elysia's built-in `ValidationProblem` in the 422 (it is never sent: the route's error hook answers validation failures with the field-error shape). Compile-time tests in `tests/unit/core/formActions.test.ts`.
- `redirect` and `htmx` are typed before the handler, so they can't infer its return type; they are declared bivariantly, so an app can annotate the parameter (`htmx: (result: ActionResult<{ email: string }>) => …`).
- The route also carries `meta: { absoluteFormAction: true }` on its Eden type, which is how the typed client finds form routes.
- The macro's hooks are the Phase 1 hooks, unchanged:
  - `parse`: cross-origin and size checks (below), before the body is read;
  - `transform`: form-field normalisation (below);
  - `error`: one message per field for a body `ValidationError`:
    - the key is the top-level field name, or a dotted path for nested fields;
    - the message is the property's `error` option when it is a string, `Required` for missing fields, and the validator's message otherwise;
    - in production Elysia reports only the first issue once any property has a custom `error`, so on failure, and only then, the body is re-checked with TypeBox `Value.Errors` to collect every field's error, with Elysia's list as the fallback;
  - `mapResponse`: turns the route's typed answer (the handler's data, or `status(422, errors)` from `fail` or the error hook) into the 303 / HTMX / browser-helper answer. Other JSON clients get the route's own answer.
- Browser forms send strings. The `transform` hook maps them onto the schema before validation:
  - An unchecked checkbox becomes `false`, and `on`/`true`/`1` become `true`.
  - `''` in a number field means not given. A numeric string becomes a number.
  - A single value for an array field becomes `[value]`, and a missing one becomes `[]`.
  - An empty file input is dropped.
  - Only top-level fields are mapped.
- The handler returns data on success. It returns `fail(errors, message?)` for errors it finds itself, or a raw `Response` as an escape hatch (passed through as is).

### Addressing an action by path: the typed client

```ts
// actions.ts — imported by the server's routes and by pages
import { createFormActionClient } from '@absolutejs/absolute/react/hooks';
import type { Server } from './backend/server';

export const actions = createFormActionClient<Server>();

// the page's route (server):
.get('/', (): Promise<Response> =>
	handleReactPageRequest({ Page: Signup, index, props: { signupState: actions.getActionState('/actions/signup') ?? null } }))

// the page (browser):
const signup = actions.useFormAction('/actions/signup', { initialState: signupState });
```

- Paths are checked against `typeof server['~Routes']` (path segments → `post` → `meta`, what Eden reads): only POST routes that use `form`. `state`, `data`, `errors` and `values` are typed from the route (`FormActionPaths`, `FormActionStateOf`, `FormActionDataOf`, `FormActionFieldsOf`).
- Where each part lives: the factory is browser safe. `getActionState` reads the result cookie from the request the request context keeps on `globalThis` (`src/utils/formActionState.ts`), so it needs no server import and returns undefined in the browser. `@absolutejs/absolute` and `@absolutejs/absolute/client` export the framework-free factory (`getActionState`, `submitFormAction`, `formActionReducer`); `@absolutejs/absolute/react/hooks` exports the same factory plus `useFormAction`. The app type is imported with `import type`, so no server code reaches a client bundle.
- In a route of the same app, give the handler a return type, as above: TypeScript can't infer a route's type from code typed by the app the route belongs to (it reports the server as referenced in its own initializer). The plain `getActionState(path)` (untyped, `ActionResult | undefined`) needs no annotation, and the page's hook types the state either way.
- Without the factory, `getActionState(path)`, `useFormAction<Data, Fields>(path)` and `submitFormAction<Data, Fields>(path, body)` take the types as parameters.
- Svelte, Vue and Angular have no form-action helpers yet (Phase 2); their pages use `getActionState` for props and `enhanceForms` / `submitFormAction` in the browser.

### One handler, three kinds of caller

| Caller | How it's recognised | Answer |
| --- | --- | --- |
| Plain `<form method="post">` (no JS) | anything else (form content type, HTML `Accept`) | `303` to `redirect` on success, else back to the page (same-origin `Referer`, else `/`). The result rides in a cookie. |
| Browser helpers | `x-absolute-action` header | JSON result, always `200`, so an invalid form doesn't log a console error |
| Other JSON clients (Eden, fetch) | JSON content type, or an `Accept` that wants JSON and not HTML | The handler's data with `200`, or the field errors with `422` |
| HTMX | `HX-Request: true` | The `htmx` option's `htmx(result)` fragment (`200`, so HTMX swaps it), or `HX-Redirect` plus the cookie (same as no-JS) when there is no fragment |

### Without JavaScript: Post/Redirect/Get with a one-shot result cookie

- **The cookie.** On a no-JS post the result goes into `absolute_action`: base64url JSON of `{ action, route?, result }`. `action` is the path posted to; `route` is the route pattern when it differs (a route with path parameters), so `getActionState('/items/:id')` and `getActionState('/items/3')` both find it.
  - Attributes: `HttpOnly; SameSite=Lax; Path=/; Max-Age=60`, plus `Secure` on https.
  - For errors it carries what the user typed, but never files or secret-looking fields (`password`, `token`, `card`, `cvc`…). `preserveValues: false` turns the echo off entirely.
  - It is shrunk to fit about 3.5 KB: values go first, then data, then everything but the outcome.
- **Why a cookie rather than rendering in the POST response.** Without a file router the action URL is not the page URL, so rendering in place would leave the action URL in the address bar, and a reload would re-POST or 404. PRG keeps the page's URL, and a reload is a clean GET.
- **SSR pages (React now, the other frameworks in Phase 2).** The route reads `getActionState('/actions/signup')` (or the typed `actions.getActionState`; the request comes from the request context) and passes it as a prop. `useFormAction(path, { initialState })` renders the errors and `values`. The state is part of the props, so hydration matches.
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

- **React** (`@absolutejs/absolute/react/hooks`): `actions.useFormAction('/actions/signup', { initialState, resetOnSuccess })` through the typed client, or `useFormAction<Data, Fields>(path, …)`.
  - It returns `{ formProps, state, pending, errors, values, data, message, submit, reset }`.
  - `formProps` is a real `{ action, method: 'post', encType: 'multipart/form-data', onSubmit }`, so the form works before hydration and with JS off.
  - Once hydrated, `onSubmit` sends `FormData` (including the submitter) with fetch. A newer submission aborts the older one, and unmount aborts too.
  - Errors keep the fields as typed. Success resets the form unless it redirects, and a `redirect` navigates.
  - Through the typed client the path is checked against the app's form routes.
- **React 19 `useActionState` compatibility:** `formActionReducer(path)` (typed through the client) is a `(prevState, formData) => Promise<ActionResult>`, so `useActionState(formActionReducer(path), initial)` works.
  - It is JavaScript-only: React SSR renders a function `action` as a `javascript:` URL without RSC.
  - The section on React Server Actions below covers how the two relate.
- **Plain pages** (`@absolutejs/absolute/client`): `enhanceForms(root?)` / `enhanceForm(form)`.
  - It upgrades `<form data-absolute-action>` to fetch, toggles `aria-busy`, `data-action-pending` and disabled submit buttons, and applies the result with the same DOM conventions the server rewriter uses (`applyActionResult`, exported).
  - It focuses the first invalid field, fires `absolute:form-action` with `{ result }`, and resets the form or follows `redirect` on success.
  - It skips `hx-post` forms.
- **HTMX:** `hx-post` + `hx-target` posts with `HX-Request`, and the route's `htmx(result)` fragment is swapped in. The same form keeps `method`/`action`/`data-absolute-action` for the no-JS path.
- `submitFormAction(path, formData, { signal })` is the framework-free primitive the above share. Network or unexpected server failures come back as `{ status: 'error', errors: {}, message }`.

### Security

- **Cross-origin protection (Phase 1, on by default).**
  - The rule, the same one Go 1.25 uses in `http.CrossOriginProtection`:
    - an `Origin` listed in `csrf.trustedOrigins` passes;
    - otherwise `Sec-Fetch-Site` must be `same-origin` or `none`;
    - if the browser didn't send it, `Origin` must match `Host`;
    - requests with neither header (curl, server-to-server, very old browsers) pass.
  - Failures get `403` before the body is read: the `parse` hook records the rejection and skips parsing, and `transform` throws it into the route's error hook.
  - A cross-site page therefore can't even set a victim's result cookie. `form: { body, csrf: false }` turns the check off for actions meant to be called from other sites.
- **CSRF tokens (Phase 3, shipped, opt-in).** Signed double-submit tokens for deployments that must cover browsers which send neither header, or that have a same-site but untrusted subdomain. `form: { body, csrf: { token: true } }`.
  - The token is `<random>.<hmac of random>` and the `absolute_csrf` cookie holds that whole string (`src/core/csrfToken.ts`). A submission must present the same string again, and is accepted only when the signature is this server's **and** the presented token equals the cookie. Both checks matter: without the equality one, any token this server ever signed would validate against another visitor's cookie; without the signature, a subdomain that can set a cookie on the parent domain could plant a value it knows and echo it back.
  - `getCsrfToken()` reads the current request through `getCurrentAbsoluteRequest()` and mints on first use, exactly as `getCspNonce()` does. The response hook in `formActionFlash.ts` sets the cookie for a request that minted one, and marks any page carrying a token `cache-control: private, no-store` — the HTML is bound to one visitor's cookie, so a shared cache must not hand it to another.
  - The header is checked where the origin check already sits; the field has to wait for `transform`, because the body does not exist in `parse`. The token is deleted from the body afterwards, so it never reaches the schema or the echoed values.
  - The HMAC key is `ABSOLUTE_SECRET` (`src/utils/signingSecret.ts`). Production refuses to invent one — a per-process key would pass a smoke test and then reject real submissions after a restart or on a second instance. Development generates one silently.
  - Pre-rendered and static pages can't embed a per-visitor token, so there `enhanceForms` / `useFormAction` read the cookie and send the header. That is why the cookie is not HttpOnly.
  - For that to work the cookie has to exist before any such page needs it, so once **any** route opts into tokens, every HTML page issues one — including pages that embed nothing. A visitor whose first stop was a static page previously had no cookie, so the helpers had nothing to send and every submission from that page was refused. Only a page that *embedded* the token is marked `private, no-store`; a page that merely received the cookie is the same bytes for everyone and keeps its caching, which is the point of pre-rendering it. An app with no token routes issues no cookie and needs no secret.
  - **A static HTML page under token mode needs JavaScript.** It is one file for every visitor, so there is no field to render into it, and behind a header-stripping proxy nothing else identifies the submission. Such a page needs JavaScript, a framework page, or token mode off. The matrix pins this down rather than leaving it to be discovered.
  - How a form gets the token:
    - **With JavaScript, automatically.** `submitFormAction` — which every binding and `enhanceForms` goes through — sends the `x-absolute-csrf` header whenever the cookie is readable. Nothing to add.
    - **Without JavaScript**, the token has to be in the markup, so each framework has a component: `<CsrfField />` (React, Vue), `CsrfField.svelte`, `<absolute-csrf-field />` (Angular). Each renders the hidden field, or nothing when there is no token.
    - **Hand-built HTML or HTMX**, `csrfField()` returns the `<input>` markup, `csrfHeaders()` the header object, and `enhanceHtmxCsrf()` attaches the header to HTMX's own requests through `htmx:configRequest`.
  - All of them read the token through `readCsrfToken()` (`src/utils/csrfTokenRef.ts`), which is dependency-free and ships to the browser: on the server it calls the getter `formActions()` registered, and in the browser it reads the cookie. Because the cookie holds the token itself, both sides arrive at the same string, so a pre-rendered page can send a header for a token it was never able to embed. This mirrors `src/utils/cspNonceRef.ts`.
  - Angular components cannot import outside `src/angular/components` (the partial compile runs in a temp workspace), so `scripts/build.ts` rewrites that one specifier and publishes the helper beside the component, as it already does for the streaming-slot registrar.
- **Body size on a chunked request (Phase 3, shipped).** `maxBodySize` was enforced from `content-length`, which a chunked request does not send — `fetch` with a stream body, or any client using `Transfer-Encoding: chunked`. Such a request declared nothing, passed the check, and could then send as much as it liked: a route with `maxBodySize: 10` would hand its handler megabytes.
  - When nothing is declared, the body is now read in `parse` with a cap, stopping at the first chunk that crosses it, so the memory a rejected request costs is bounded by the limit rather than by what the client chose to send.
  - The bytes already read are served back through the same request, by overriding the four methods Elysia's parser calls on it (`arrayBuffer`, `formData`, `json`, `text` — `blob` and `bytes` too, for completeness). Own properties shadow the prototype's, so the request keeps its identity, which matters: several `WeakMap`s here and in the request context are keyed on it.
  - That indirection is the point. Parsing the bytes here instead would mean one body shape for declared requests and another for chunked ones, differing in whatever Elysia's query parser does that a hand-rolled one does not — comma-separated values, `+`, percent escapes. A test feeds identical payloads down both paths and asserts the handler sees identical bodies.
- **The result cookie (Phase 3, shipped).** `absolute_action` carries a no-JavaScript submission's result to the page it redirects to, and the server both writes and reads it — but anyone able to set a cookie for the site can forge one and make the next page render a result of their choosing. The rewriter escapes what it writes, so the exposure is a spoofed message rather than script, which is still worth refusing.
  - The cookie is now `<payload>.<signature>`, signed with `ABSOLUTE_SECRET` under its own purpose (so a CSRF token's signature cannot stand in for it, or the reverse).
  - Signing is active except in production with no secret configured. There, a generated key would be lost on restart and differ between instances, so a visitor would submit successfully and then see nothing; instead the cookie stays unsigned, is still accepted, and the server warns once naming the variable. Setting `ABSOLUTE_SECRET` is what turns the protection on.
  - That is not a downgrade: whenever a secret is available, a cookie without a valid signature is **rejected** rather than merely preferred, so an attacker cannot strip the signature to reach the old behaviour.
  - The verifier is registered for `readActionFlash` (`src/utils/formActionState.ts`), which the typed client imports and so cannot pull in `node:crypto` itself — the same indirection as the CSP nonce and the CSRF token.
  - `secureHeaders()` already sends `form-action 'self'`. The browser helpers emit no inline scripts. Any future inline bootstrap must use `nonceAttr()` (`src/utils/cspNonceRef.ts`).
- **Auth.** An action is a route in the app, so the app's guards (`onBeforeHandle`, `.guard`) apply and its `derive` values reach the handler with their types (the reason for the `form` macro). A route-level `beforeHandle` runs after validation and sees the typed `body`, `fail` and derived values. Elysia checks what a route's own hooks return against the statuses the route declares, and a `form` route declares its 422, so the route's `beforeHandle` answers with one of these:
  - `status(401, 'Sign in first')`, after adding the status to the route's `response`. The route's map merges with the 422, and Eden gets the 401:

    ```ts
    .post('/actions/delete', {
    	beforeHandle: ({ status, user }) => (user ? undefined : status(401, 'Sign in first')),
    	form: t.Object({ confirm: t.Boolean() }),
    	response: { 401: t.String() }
    }, ({ body, user }) => …)
    ```
  - An `HTTPError` (`class Unauthorized extends HTTPError.id('UNAUTHORIZED', 401) {}`, then `return new Unauthorized()`). Elysia accepts an error from any hook, serves it as a problem body with its status, and Eden gets that status.
  - `fail(errors)`: the route's 422 with field errors.
  - A raw `Response` or `redirect()` is a type error in the route's own `beforeHandle`. Put that hook on a `.guard({ beforeHandle }, (app) => app.post(…))` or an `onBeforeHandle`, whose hooks aren't checked against the route, or return the `Response` from the handler. Handlers may always return a `Response`.

  Each of these short-circuits plain posts, HTMX and JSON callers with the hook's status. The form machinery only shapes the handler's data and 422s.
- **Size limits.**
  - `maxBodySize` defaults to 10 MiB. A request whose declared `Content-Length` exceeds it gets `413` before its body is read.
  - Chunked bodies without a length fall back to Bun's server-wide `maxRequestBodySize`. Phase 3 adds a streaming byte counter.
- **File uploads.** `t.File()` / `t.Files()` work in both paths: the hook always posts `multipart/form-data`, and plain forms need `enctype="multipart/form-data"`. Empty file inputs are dropped before validation, and files are never echoed back.
- **Open redirects.** The "back" target only comes from a same-origin `Referer` / `HX-Current-URL`, else `/`. `redirect` is developer-supplied.

### Interop

- **File router (still planned).**
  - Co-located actions become `form` routes that the router mounts at the page's own path: `POST /signup` for the default action, `POST /signup?/delete` for a named one, as in SvelteKit. A page module exports the route options and handler (for example `export const action = { form: t.Object(…), handler }`), and the router registers `.post(pagePath, { form }, handler)` on the app, so guards and `derive` apply to them like any route.
  - With the action at the page URL, the no-JS path can render the page directly in the POST response (status 422 on error), with no cookie. The router supplies `getActionState` from the in-flight result instead of the cookie, so page code is the same either way.
  - Agreed contract for the router agent: actions are declared with `form`, not as separate values, and the router must not mount its own POST handler at a page path that has actions.
- **Prerendered / ISR pages.** A prerendered page is served by the prerender plugin's `onRequest`, before the result renders.
  - With JS the helpers work unchanged.
  - Without JS, Phase 2 makes the prerender plugin skip the cached file when the `absolute_action` cookie is present, so the live handler renders the result. That is a one-line check in `prepare.ts`.
  - The response is already `no-store`, so it never poisons the prerender or ISR cache.
- **Streaming.** Results are known before render begins, so a streamed page gets them as props.
  - The HTML rewriter is streaming (`HTMLRewriter.transform`), so static pages keep their streaming slots.
  - Streaming-slot patches are separate inline scripts that the rewriter doesn't touch. A form inside a streamed slot isn't rewritten without JS (documented limitation).
- **React Server Actions (designed in parallel).** RSC server actions (`'use server'` functions, `<form action={fn}>`, `useActionState(fn, init, permalink)`) are a separate mechanism with a different transport (the RSC action ID protocol).
  - To avoid collisions, form actions own the `form` route option and the names `formActions`, `createFormActionClient`, `getActionState`, `useFormAction`, `submitFormAction`, `formActionReducer`, `enhanceForms`, the `x-absolute-action` header and the `absolute_action` cookie.
  - The RSC work should use `serverAction` / `'use server'` naming and its own header (for example `Next-Action`-style `x-absolute-rsc-action`).
  - Where they meet: Phase 4 wraps the same `form` route handler, with its schema and validation unchanged, as a server-action-compatible function for RSC pages. RSC `useActionState` with a permalink then gets the same no-JS behaviour, and one handler serves both. Until then they coexist: RSC pages use server actions, every other page uses form actions.

## Phases

### Phase 1 (done): server, no-JS, React, static HTML, HTMX

- Implemented:
  - the `form` route option (`formActions()`, in the `absolutejs` plugin) with Elysia schemas, typed field errors, `fail`, and the `redirect`, `htmx`, `csrf`, `maxBodySize` and `preserveValues` options. It replaced Phase 1's `defineAction(path, options)` + `.use(action)`, which typed the action before it met the app (a derived `user` was `unknown`);
  - `getActionState` and the typed client `createFormActionClient<typeof server>()`;
  - `formActionRuntime` (mounted by `prepare()`);
  - `submitFormAction`, `formActionReducer`, `enhanceForm(s)` and `applyActionResult`;
  - React `useFormAction`;
  - types in `types/formAction.ts`.
- Exit criteria, all met:
  - Unit: 30 tests (`tests/unit/core/formActions.test.ts`) over JSON, no-JS, HTMX, protection and the options shape, plus compile-time checks of the handler (typed `user`, `fail`), Eden (body, 200, 422) and the typed client.
  - Browser: 8 tests (`tests/integration/server/form-actions.test.ts`) in a production build with `secureHeaders()`:
    - React, HTML and HTMX pages, each with JavaScript on and off (Playwright `javaScriptEnabled: false`);
    - no reload with JS;
    - no CSP violations;
    - the cross-site 403;
    - a JSON client.
  - Browser: 8 tests (`tests/integration/server/form-actions-scaffold.test.ts`) in an app laid out like a create-absolutejs scaffold, with the typed client on a React page, `enhanceForms` on an HTML page and `hx-post` on an HTMX page, JS on and off, and `absolute typecheck` over the app.
  - Packed-tarball E2E: a scaffolded app (create-absolutejs, React+Svelte+Vue+HTML+HTMX), with the tarball installed:
    - 27/27 browser checks under both `absolute build` + `start` (production) and `absolute dev`;
    - the app typechecks, including the Eden check that a missing `email` field fails.

### Phase 2: Svelte, Vue, Angular, auth binding, prerender

- Svelte: `formAction(path)` returning a store `{ state, pending, errors, values }` plus `use:enhance`. Vue: `useFormAction` composable returning refs and `formProps`. Angular: `[absoluteAction]` directive plus `FormActionService` (signals). All three are thin wrappers over `submitFormAction` and `applyActionResult`.
- `getActionState` documented for each framework's props path (Svelte/Vue/Angular handlers already take props).
- Prerender bypass when the result cookie is present.
- Exit: the Phase 1 browser matrix extended to Svelte, Vue and Angular pages, JS on and off, in dev and production.

### Phase 3: hardening

- ~~Signed CSRF tokens (`getCsrfToken`, `csrfField`, automatic in the helpers) as an opt-in `csrf: { token: true }`.~~ Shipped; see Security above.
- ~~A signed result cookie.~~ Shipped; see Security above.
- ~~Streaming byte limits for chunked bodies.~~ Shipped; see Security above.
- ~~Nested-object and array-of-object field paths (`address.city`, `items[0].qty`) in normalisation and value echo.~~ Shipped:
  - Both notations are read (`items[0].sku` and `items.0.sku`), and a path is written back in the one most form authors use — dots between keys, brackets around indices — so a failure at `/items/0/sku` is reported as `items[0].sku` and lands on that input.
  - Expansion is driven by the schema, never by the submitted names: a name the schema does not declare is left exactly as it arrived and fails validation as an unknown field rather than creating something. That is also what makes `__proto__.polluted=1` inert, with an explicit refusal of `__proto__`, `constructor` and `prototype` on top.
  - Normalisation recurses, so a checkbox two levels down still arrives as `false` when it was not ticked, and an array of objects normalises each entry. A sparse index (`items[2]` with no `items[0]`) is compacted rather than left as holes that validate as missing objects.
  - A property's own `error` message now resolves along the path, so `address.city` reads the message on `city` instead of the one on `address`.
  - The echoed values stay keyed by the names the inputs had, because that is what the no-JavaScript re-render and the bindings match against; `captureValues` runs before expansion for that reason.
- Optimistic updates (`optimistic(formData)` in the hook).
- Exit:
  - ~~token mode passes the matrix with `Sec-Fetch-Site` stripped by a proxy~~ — `tests/integration/server/form-actions-csrf-token.test.ts`: the app is reached through a proxy that strips `Origin`, `Sec-Fetch-Site` and `Sec-Fetch-Mode`, a control route proves a cross-site post is accepted without tokens in that setup, and a real browser drives a React page with JavaScript off and a static HTML page with it on;
  - fuzzed cookies never break rendering;
  - an oversized chunked upload gets 413.

### Phase 4: file router and RSC convergence

- Co-located page actions mounted by the file router as `form` routes at the page URL, with in-place no-JS rendering.
- An RSC server-action adapter wrapping the same `form` route handler, so one handler serves both.
- Exit: the same signup form defined once works on an RSC page and a non-RSC page, with JS on and off.

## Known limitations (Phase 1)

- Values are echoed only for top-level fields, and nested schemas validate but aren't normalised.
- A form inside a streaming slot isn't rewritten without JS.
- Prerendered pages show no-JS results only after the Phase 2 bypass.
- A route that uses the typed client inside the same app needs a handler return type (see the typed client above).
- `redirect` and `htmx` can't infer the handler's data type; annotate their parameter.
- A route's own `beforeHandle` can't return a raw `Response`, and its `status()` takes only the statuses the route declares. Elysia rc.1 checks those against the route's response map, and the `form` route must declare its 422 to keep Elysia's `ValidationProblem` out of Eden's 422. Declare the status in `response`, return an `HTTPError`, or use a guard (see Auth above).
- The result cookie is unsigned (see Trust above).
