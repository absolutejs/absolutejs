import type { Context, UnwrapSchema } from 'elysia';
import type {
	FormActionContext,
	FormActionSchemaOf,
	FormActionValue
} from './formAction';

/* A file route's own form action: `export const action` in its server
 * module (src/core/pageAction.ts). */

/** What a page action's handler is given: the validated fields, `fail`,
 *  and the parts of the request a handler reads.
 *
 *  A subset of the context Elysia gives the route, by design: the
 *  action is written in one file and registered from another, so its
 *  handler is typed here, on its own, and has to be something the route
 *  can be handed. Anything else on Elysia's context is still there at
 *  run time. */
export type PageActionContext<Value extends FormActionValue> =
	FormActionContext<Value> & {
		body: UnwrapSchema<FormActionSchemaOf<Value>>;
		headers: Record<string, string | undefined>;
		/** The route's params. Typed loosely: the module that defines the
		 *  action does not know the path it will be registered under. */
		params: Record<string, string>;
		query: Record<string, string | undefined>;
		request: Request;
		set: Context['set'];
	};

/** A file route's form action, made by `defineAction`. */
export type PageAction<
	Value extends FormActionValue = FormActionValue,
	Result = unknown
> = {
	/** The `form` route option: the schema, or `{ body, …options }`. */
	form: Value;
	handler: (context: PageActionContext<Value>) => Result;
	kind: 'absolute:page-action';
};
