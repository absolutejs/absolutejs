# Form actions: a `form` schema on a normal route (API proposal)

Status: proposal, 2026-11-15. Agreed by Alex; for Gene to review before
implementation. It replaces the `defineAction(path, …)` + `.use(action)`
surface from Phase 1 (`docs/FORM_ACTIONS_PLAN.md`). Everything else in Phase 1
stays the same: the no-JS Post/Redirect/Get with the result cookie, the HTMX
and browser-helper answers, CSRF, form-field normalisation, `useFormAction`,
`enhanceForms` and the static-page rewriter.

## Why change it

Alex read the blog sample (`.use(createUser)`) as `.use` on a function. It
isn't: `defineAction` returns `new Elysia().post(path, …)` with `actionPath`
assigned onto it, so `.use(createUser)` is a plugin mount and is legal. But
the shape has costs we can't fix while the action is built on its own,
before it meets the app. Checked against beta.183:

| What | Result |
| --- | --- |
| The app's guards (`onBeforeHandle`) apply to the action | ✅ a signed-out post got the app's 401 |
| The app's `derive` / `resolve` values reach the handler at runtime | ✅ the handler saw `user` |
| …with a type | ❌ `context.user` is `unknown`. The action is typed before it is mounted, so it can't know the app |
| Eden types the request body | ✅ a missing field is a type error |
| Eden types the response | ❌ was `Response`. **Fixed separately in #115** (typed 200 data, 422 field errors) |
| Routes are declared in the app's chain | ❌ declared elsewhere and `.use`d, a second way to declare a route |

The typed signed-in user is the one that matters: every real action needs
`user`, `db`, or a tenant, and they all come from the app's `derive` /
`resolve`.

## The proposal

A form action is a normal Elysia route with a `form` schema instead of
`body`. `form` is an Elysia macro that ships with the framework.

```ts
import { t } from 'elysia';

app
	.use(auth) // derives `user`, like any app
	.post(
		'/actions/signup',
		{
			form: t.Object({
				email: t.String({ error: 'Enter a valid email', format: 'email' }),
				name: t.String({ error: 'Name must be at least 2 characters', minLength: 2 })
			})
		},
		({ body, fail, user }) =>
			body.name === 'taken'
				? fail({ name: 'That name is taken' }) // a typo'd field is a type error
				: { greeting: `Welcome, ${body.name}`, by: user.name } // user typed from auth
	)
	.get('/signup', () =>
		handleReactPageRequest({
			Page: Signup,
			index: asset(manifest, 'SignupIndex'),
			props: { signupState: getActionState('/actions/signup') ?? null }
		})
	);
```

What it gets us:

- **`.use` only takes plugins.** There's no per-action `.use`. The macro comes
  with the `absolutejs` plugin, the same place `formActionRuntime()` is
  mounted today (`prepare()`), so apps write no extra `.use` at all. A plain
  Elysia app without the framework plugin would `.use(formActions())` once.
- **One way to declare a route.** An action is a route in the chain: guards,
  `derive`, `resolve`, groups and prefixes apply exactly as they do to
  `.get`.
- **Typed end to end.** `body` is typed from `form`, `user` from the app, and
  `fail` from `form`'s fields. Eden types the body, the success data and the
  422 field errors.
- **Same behaviour for every caller.** The macro carries the Phase 1 hooks
  unchanged: `parse` (CSRF and the size limit), `transform` (form-field
  normalisation), `error` (validation errors as one message per field) and
  `mapResponse` (303 + result cookie, HTMX fragment or `HX-Redirect`,
  browser-helper JSON). #115 already moved the per-caller answer into
  `mapResponse`, so this is the same code under a different entry point.

Options that were `defineAction` options become macro options alongside the
schema, still type-checked, e.g. `form: t.Object(…)` plus a sibling
`formOptions: { redirect, htmx, csrf, maxBodySize, preserveValues }`, or
`form: { body: t.Object(…), redirect: … }`. That's an open detail (below).

## What the spikes proved (Elysia 2.0.0-rc.1)

1. **A typed signed-in user.** With `.use(auth)` deriving `user`, the handler
   sees `user.name: string`. No `context` cast is needed.
2. **`fail` typed by the form's fields.** `fail({ nope: 'x' })` is a compile
   error: `'nope' does not exist in type 'Partial<Record<"name", string>>'`.
3. **Eden's view of the route:**
   `body: { name: string; newsletter: boolean }`,
   `response[200]: { greeting: string; by: string }`,
   `response[422]: { errors: Partial<Record<'name' | 'newsletter', string>>; message?: string; status: 'error' } | ValidationProblem`.
4. **Runtime.** An unchecked checkbox becomes `false` and a checked one `true`
   (the transform uses the form schema). `fail` answers 422 JSON. A plain
   form post (`Accept: text/html`) gets its 303.

### Why `form: schema` and not `body: schema, formAction: true`

We tried the flag first. A macro's type lambda (`$type: macroType<…>()`) only
receives the macro's own value (`this['input']`), not the route's context:
`this['context']` is `unknown` there. Elysia passes context to a macro's
*option* type, not its *output*. With a `true` flag, `fail` can't know the
route's fields. With the schema as the macro's value, the lambda types
`body` and `fail` from it, and at runtime the macro holds the schema, so the
transform and error hooks need no route introspection.

(Elysia's `introspect(hook)` also works for the runtime half: it sees the
route's final hooks, including `body`, and can add hooks. With `form: schema`
we don't need it.)

Two details that matter for the implementation:

- The runtime `fail` is typed as `{}` in the macro's `derive`. Its typed
  signature comes only from the lambda's `output`, because the two
  intersect into overloads and a loosely typed runtime `fail` would win.
- `this` can't appear inside a nested type literal in the lambda, so put
  the output in a named type (`FormOutput<this['input']>`).

## Open details for Gene

1. **Where the options go:** `form: t.Object(…)` plus `formOptions`, or
   `form: { body, redirect, htmx, csrf, … }`. The second keeps everything
   in one place. Check that the type lambda still extracts the schema from
   the object.
2. **The client and the page route.** Address actions by path, checked
   against the app's routes:
   `getActionState<typeof app, '/actions/signup'>()` and
   `useFormAction<typeof app, '/actions/signup'>()`. The types come from
   `typeof app['~Routes']` (path segments → method → `response`), which is
   what Eden reads. Not spiked yet; it's plain type-level path lookup.
3. **`ValidationProblem` in the 422 union.** It's Elysia's built-in
   validation type. Our `error` hook answers validation failures with the
   field-error shape, so check whether a macro `response` schema can replace
   it in the 422 union, or document that the union carries both.
4. **File router.** Colocated actions become routes the router mounts at the
   page path with `form`, the same as today's plan but without
   `FormActionDefinition` values.
5. **Phase 4 (RSC server actions)** wraps the same handler, unchanged.
6. **`defineAction`.** It's two days old and in beta. Replace it rather than
   keep both: one way to do it. The blog post sample needs the new form.

## Package

Keep form actions in `@absolutejs/absolute`. It's about 1,560 lines today.
Its framework coupling is small now (the request context and the `prepare()`
mount) but everything planned couples it further: the file router,
prerender/ISR skip, the RSC bridge, per-framework helpers through the
framework's subpath exports, and CSRF tokens through the request context.
A separate package would need public framework APIs for each and lockstep
releases. If plain Elysia apps ever want it, the macro core can be extracted
as `@absolutejs/form-actions` later and re-exported.

## Appendix: the spike

```ts
import { Elysia, macroType, status, t, type ElysiaStatus, type MacroTypeLambda, type UnwrapSchema } from 'elysia';
import type { TObject } from 'typebox';

type FieldErrors<Fields extends string> = Partial<Record<Fields, string>>;
type FieldsOf<Schema> = Schema extends TObject ? Extract<keyof UnwrapSchema<Schema>, string> : never;
type FormOutput<Schema> = {
	fail: (
		errors: FieldErrors<FieldsOf<Schema>>,
		message?: string
	) => ElysiaStatus<422, { errors: FieldErrors<FieldsOf<Schema>>; message?: string; status: 'error' }>;
};
interface FormType extends MacroTypeLambda {
	body: Extract<this['input'], TObject>;
	output: FormOutput<this['input']>;
}

const fail = (errors: Record<string, string>, message?: string) =>
	status(422, { errors, message, status: 'error' as const });
const failContext = (): {} => ({ fail }); // typed by FormType's output instead

const formActions = () =>
	new Elysia({ name: 'absolutejs-form-actions' }).macro({
		form: (schema: TObject) => ({
			$type: macroType<FormType>(),
			body: schema,
			derive: failContext
			// + parse / transform / error / mapResponse from formActions.ts
		})
	});

const auth = new Elysia({ name: 'auth' }).derive('global', () => ({ user: { name: 'Alice' } }));

export const app = new Elysia()
	.use(auth)
	.use(formActions())
	.post(
		'/actions/signup',
		{ form: t.Object({ name: t.String({ minLength: 2 }), newsletter: t.Boolean() }) },
		({ body, fail, user }) =>
			body.name === 'taken'
				? fail({ name: 'That name is taken' })
				: { greeting: `Welcome, ${body.name}`, by: user.name }
	);
```
