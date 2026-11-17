import type { ElysiaStatus, MacroTypeLambda, UnwrapSchema } from 'elysia';
import type { TObject, TUnsafe } from 'typebox';

/**
 * Public type surface for form actions: the `form` route option on the
 * server, `createFormActionClient` / `useFormAction` / `enhanceForms` in
 * the browser. Browser code imports these types only, so a page can type
 * its form against the server's routes with
 * `import type { server } from '../../server'` and never pull server code
 * into its bundle.
 */

/** Field name → message, one message per field. */
export type ActionFieldErrors<Fields extends string = string> = Partial<
	Record<Fields, string>
>;

/** What the user typed, echoed back after a submission without
 *  JavaScript failed, so the form can be refilled. Files and fields whose
 *  name looks secret (password, token, card…) are never echoed. */
export type ActionFormValues<Fields extends string = string> = Partial<
	Record<Fields, string | string[]>
>;

export type ActionIdleState = { status: 'idle' };

export type ActionSuccessState<Data = unknown> = {
	status: 'success';
	/** The handler's return value. Undefined after a submission without
	 *  JavaScript when the value didn't fit the result cookie (~3.5 KB). */
	data?: Data;
	/** Where the browser goes next, when the action sets `redirect`. */
	redirect?: string;
};

export type ActionErrorState<Fields extends string = string> = {
	status: 'error';
	errors: ActionFieldErrors<Fields>;
	/** A message for the whole form (`fail(errors, message)`, or a
	 *  network / server failure seen by the browser helpers). */
	message?: string;
	values?: ActionFormValues<Fields>;
};

/** What a submission produces. */
export type ActionResult<Data = unknown, Fields extends string = string> =
	ActionErrorState<Fields> | ActionSuccessState<Data>;

/** A form's state: idle until the first submission. */
export type ActionState<Data = unknown, Fields extends string = string> =
	ActionIdleState | ActionResult<Data, Fields>;

/* ---------------------------------------------------------------- *
 * The `form` route option (server)
 * ---------------------------------------------------------------- */

export type ActionCsrfOptions = {
	/** Origins (scheme://host[:port]) allowed to post besides the page's
	 *  own, e.g. a separate front-end domain. */
	trustedOrigins?: readonly string[];
};

/* Method syntax keeps these callbacks bivariant, so an app can annotate
 * `data` / `result` with its handler's real type (the option is typed
 * before the handler, so it can't infer it). */
type RedirectTarget = {
	target(data: unknown): string;
}['target'];

/** `form: { body, …options }`: the schema plus the action's options. */
export type FormActionOptions<Schema extends TObject = TObject> = {
	/** The form's fields (an Elysia `t.Object`). Field names are the keys;
	 *  add `error: 'message'` to a property for a friendlier message than
	 *  the validator's. */
	body: Schema;
	/** Cross-origin protection: requests whose `Sec-Fetch-Site` / `Origin`
	 *  say another site sent them get 403. Default on; `false` turns it
	 *  off (for an API meant to be called from other sites). */
	csrf?: ActionCsrfOptions | false;
	/** HTMX requests only: the HTML fragment to swap in for a result
	 *  (answered with 200, which HTMX swaps by default). Return undefined
	 *  to fall back to the no-JavaScript behaviour (`HX-Redirect`).
	 *  `result.data` is the handler's return value; annotate the parameter
	 *  (`(result: ActionResult<{ email: string }>) => …`) to type it. */
	htmx?(
		result: ActionResult,
		request: Request
	): string | undefined | Promise<string | undefined>;
	/** Bytes; requests that declare a larger body get 413 before it is
	 *  read. Default 10 MiB. */
	maxBodySize?: number;
	/** Echo what the user typed back to the page after a failed
	 *  submission without JavaScript (files and secret-looking fields are
	 *  never echoed). Default true. */
	preserveValues?: boolean;
	/** Where to send the browser after success. Default: back to the page
	 *  the form was on. A function gets the handler's return value. */
	redirect?: string | RedirectTarget;
};

/** The `form` route option: the schema alone, or `{ body, …options }`. */
export type FormActionValue = TObject | FormActionOptions;

/** The schema a `form` value carries.
 *
 *  Read through `keyof` and an indexed access, never an object pattern
 *  (`Value extends { body: infer Schema }`): when the route's hook also
 *  has a callback that reads the context (`beforeHandle: ({ user }) => …`),
 *  TypeScript resolves the macro's types while it is still inferring the
 *  hook object, and an object pattern against `{ body, redirect, … }`
 *  then settles on its false branch for good (the body became `never`).
 *  Key and property lookups are re-read once the hook is inferred. */
export type FormActionSchemaOf<Value> = 'body' extends keyof Value
	? Extract<Value['body' & keyof Value], TObject>
	: Extract<Value, TObject>;

/** The field names of a `form` value's schema. */
export type FormActionFieldsOfValue<Value> = Extract<
	keyof UnwrapSchema<FormActionSchemaOf<Value>>,
	string
>;

/** A `form` route's 422 body: the field errors, one message per field.
 *  Both `fail(...)` and a submission that fails validation answer it. */
export type FormActionFailure<Fields extends string = string> = {
	errors: ActionFieldErrors<Fields>;
	message?: string;
	status: 'error';
};

/** What a `form` route's handler gets besides the usual context. */
export type FormActionContext<Value> = {
	/** Answer with field errors (and an optional form-level message)
	 *  instead of a result: a 422 with the field errors. */
	fail: (
		errors: ActionFieldErrors<FormActionFieldsOfValue<Value>>,
		message?: string
	) => ElysiaStatus<422, FormActionFailure<FormActionFieldsOfValue<Value>>>;
};

/** What the `form` macro's hooks read from Elysia's context. Named, so
 *  the macro's published type stays small and stable. */
export type FormActionHookContext = {
	body?: unknown;
	request: Request;
	route?: string;
	set: { status?: number | string };
};

export type FormActionErrorContext = FormActionHookContext & {
	error: unknown;
};

export type FormActionResponseContext = FormActionHookContext & {
	responseValue: unknown;
};

/** Marks a route as a form action on its Eden type (`meta`), which is
 *  how `createFormActionClient` finds the app's form routes. */
export type FormActionRouteMeta = { absoluteFormAction: true };

/** The `form` macro's per-route types: `body` and `fail` from the
 *  schema, and a 422 that is only the field-error shape. */
// Elysia's macro type lambdas read `this`, which only an interface has.
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export interface FormActionMacroType extends MacroTypeLambda {
	body: FormActionSchemaOf<this['input']>;
	output: FormActionContext<this['input']>;
	response: FormActionResponse<this['input']>;
}

/** The `form` route's response schema as Eden sees it: 422 is the field
 *  errors (Elysia's built-in validation body is never sent; the route's
 *  error hook answers validation failures with this shape).
 *
 *  Only a declared 422 replaces Elysia's `ValidationProblem` in Eden, and
 *  Elysia checks a route's own hooks and `status()` against the statuses
 *  it declares, so the route's `beforeHandle` may answer 422 (`fail`)
 *  and the statuses the route adds to its `response` (`response: { 401:
 *  t.String() }`, merged with this), or return an `HTTPError`. A map
 *  Elysia would leave open (optional or indexed keys) counts as no
 *  declaration, and the 422 becomes a union with `ValidationProblem`. */
export type FormActionResponse<Value> = {
	422: TUnsafe<FormActionFailure<FormActionFieldsOfValue<Value>>>;
};

/* ---------------------------------------------------------------- *
 * Addressing a form route by path (createFormActionClient)
 * ---------------------------------------------------------------- */

type RouteLeaf = {
	headers: unknown;
	params: unknown;
	query: unknown;
	response: unknown;
};
type FormRouteLeaf = RouteLeaf & { meta: FormActionRouteMeta };
type MaxRouteDepth = 16;

type FormPathsIn<
	Routes,
	Prefix extends string,
	Depth extends 1[]
> = Depth['length'] extends MaxRouteDepth
	? never
	: {
			[Key in keyof Routes & string]: Key extends 'post'
				? Routes[Key] extends FormRouteLeaf
					? Prefix extends ''
						? '/'
						: Prefix
					: never
				: Routes[Key] extends RouteLeaf
					? never
					: FormPathsIn<
							Routes[Key],
							`${Prefix}/${Key}`,
							[...Depth, 1]
						>;
		}[keyof Routes & string];

type PathSegments<Path extends string> = Path extends `/${infer Rest}`
	? PathSegments<Rest>
	: Path extends ''
		? []
		: Path extends `${infer Head}/${infer Rest}`
			? [Head, ...PathSegments<Rest>]
			: [Path];

type RoutesAt<Routes, Segments> = Segments extends [
	infer Head extends string,
	...infer Rest
]
	? RoutesAt<Routes[Head & keyof Routes], Rest>
	: Routes;

type RoutesOf<App> = App extends { '~Routes': infer Routes } ? Routes : never;

type FormRouteAt<App, Path extends string> =
	RoutesAt<RoutesOf<App>, PathSegments<Path>> extends {
		post: infer Route;
	}
		? Route
		: never;

/** Every path in `App` (`typeof server`) served by a `form` route. */
export type FormActionPaths<App> = FormPathsIn<RoutesOf<App>, '', []>;

/** What the `form` route at `Path` answers on success (its handler's
 *  return value). */
export type FormActionDataOf<App, Path extends string> =
	FormRouteAt<App, Path> extends { response: { 200: infer Data } }
		? Data
		: unknown;

/** The field names of the `form` route at `Path`. */
export type FormActionFieldsOf<App, Path extends string> =
	FormRouteAt<App, Path> extends { body: infer Body }
		? Extract<keyof Body, string>
		: string;

export type FormActionResultOf<App, Path extends string> = ActionResult<
	FormActionDataOf<App, Path>,
	FormActionFieldsOf<App, Path>
>;

export type FormActionStateOf<App, Path extends string> = ActionState<
	FormActionDataOf<App, Path>,
	FormActionFieldsOf<App, Path>
>;
