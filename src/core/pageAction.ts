import type { FormActionValue } from '../../types/formAction';
import type { PageAction, PageActionContext } from '../../types/pageAction';

/* A file route's own form action.
 *
 * A form action is a POST route with a `form` schema (formActions.ts),
 * and until now it had to be written where the app's routes are, away
 * from the page whose form posts to it. A file route can export one
 * from its server module instead:
 *
 *     // routes/blog/[slug].server.ts
 *     export const action = defineAction(
 *       t.Object({ comment: t.String({ minLength: 2 }) }),
 *       async ({ body, fail, params }) => {
 *         if (await isSpam(body.comment)) return fail({ comment: 'No.' });
 *         return { id: await addComment(params.slug, body.comment) };
 *       }
 *     );
 *
 * and the build registers it as `POST` on the route's own path — the
 * address the page is at, so a plain `<form method="post">` with no
 * `action` attribute posts to it.
 *
 * It is not a second kind of action. The generated route module turns
 * it into the same `.post(path, { form }, handler)` an app would write
 * by hand, so validation, field errors, the CSRF checks, the
 * no-JavaScript round trip and the typed client are the ones every form
 * action has, and none of them is implemented twice. */

const KIND = 'absolute:page-action';

/** Defines a file route's form action. `form` is the `form` route
 *  option — a `t.Object`, or `{ body, redirect, … }` — and `handler` is
 *  the route's handler: it is given the validated `body`, `fail`, and
 *  the request's `params`, `query`, `headers`, `request` and `set`. */
export const defineAction = <Value extends FormActionValue, Result>(
	form: Value,
	handler: (context: PageActionContext<Value>) => Result
) => {
	const action: PageAction<Value, Result> = { form, handler, kind: KIND };

	return action;
};

/** @internal Whether a server module's `action` export is one. */
export const isPageAction = (value: unknown): value is PageAction =>
	typeof value === 'object' &&
	value !== null &&
	'kind' in value &&
	value.kind === KIND;
