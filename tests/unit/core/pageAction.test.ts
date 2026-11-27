import { describe, expect, test } from 'bun:test';
import { Elysia, t } from 'elysia';
import type {
	FormActionDataOf,
	FormActionFieldsOf,
	FormActionPaths
} from '../../../types/formAction';
import { formActions } from '../../../src/core/formActions';
import { defineAction, isPageAction } from '../../../src/core/pageAction';

/* A file route's own form action: defined in the route's server module,
 * registered from the generated route module as an ordinary `form`
 * route. Most of what is checked here is checked by the compiler — that
 * an action written in one place can be handed to a route in another,
 * and that the app's type then knows it. */

const comment = defineAction(
	t.Object({ comment: t.String({ minLength: 2 }) }),
	({ body, fail, params }) => {
		if (body.comment === 'spam') return fail({ comment: 'No.' });

		return { post: params.slug ?? '', text: body.comment };
	}
);

const subscribe = defineAction(
	{ body: t.Object({ email: t.String() }), redirect: '/thanks' },
	({ body }) => ({ email: body.email })
);

/* One of a route's named actions (`export const actions = { remove }`). */
const remove = defineAction(t.Object({ id: t.String() }), ({ body }) => ({
	removed: body.id
}));

/* What the generated route module does with them. */
const routeActions = new Elysia()
	.use(formActions())
	.post('/blog/:slug', { form: comment.form }, comment.handler)
	.post('/newsletter', { form: subscribe.form }, subscribe.handler)
	// A named action: the route's path, then `/_name`.
	.post('/blog/:slug/_remove', { form: remove.form }, remove.handler);

/* An app that uses them, as a server would. */
const app = new Elysia().use(routeActions).get('/', () => 'home');

type App = typeof app;

type Same<Left, Right> = [Left] extends [Right]
	? [Right] extends [Left]
		? true
		: false
	: false;

const holds = <Check extends true>(check?: Check) => check;

describe('a page action, as the app’s type sees it', () => {
	test('is one of the app’s form routes, at the path it was registered under', () => {
		holds<
			Same<
				FormActionPaths<App>,
				'/blog/:slug' | '/blog/:slug/_remove' | '/newsletter'
			>
		>();
	});

	test('has the fields of its schema', () => {
		holds<Same<FormActionFieldsOf<App, '/blog/:slug'>, 'comment'>>();
		holds<Same<FormActionFieldsOf<App, '/newsletter'>, 'email'>>();
	});

	test('answers with what its handler returns', () => {
		holds<
			Same<
				FormActionDataOf<App, '/blog/:slug'>,
				{ post: string; text: string }
			>
		>();
		holds<Same<FormActionDataOf<App, '/newsletter'>, { email: string }>>();
	});

	test('knows a named action as a route of its own', () => {
		holds<Same<FormActionFieldsOf<App, '/blog/:slug/_remove'>, 'id'>>();
		holds<
			Same<
				FormActionDataOf<App, '/blog/:slug/_remove'>,
				{ removed: string }
			>
		>();
	});
});

const post = (path: string, fields: Record<string, string>) =>
	app.handle(
		new Request(`http://localhost${path}`, {
			body: new URLSearchParams(fields),
			headers: {
				accept: 'application/json',
				'content-type': 'application/x-www-form-urlencoded',
				origin: 'http://localhost',
				'x-absolute-action': '1'
			},
			method: 'POST'
		})
	);

describe('a page action, registered as a form route', () => {
	test('is given the validated fields and the route’s params', async () => {
		const response = await post('/blog/hello', { comment: 'nice post' });

		expect(await response.json()).toEqual({
			data: { post: 'hello', text: 'nice post' },
			status: 'success'
		});
	});

	test('fails a field through `fail`, like any form action', async () => {
		const response = await post('/blog/hello', { comment: 'spam' });

		expect(await response.json()).toMatchObject({
			errors: { comment: 'No.' },
			status: 'error'
		});
	});

	test('has its schema enforced before the handler runs', async () => {
		const response = await post('/blog/hello', { comment: 'x' });
		const result: { errors?: Record<string, string>; status?: string } =
			await response.json();

		expect(result.status).toBe('error');
		expect(Object.keys(result.errors ?? {})).toEqual(['comment']);
	});

	test('carries its options: a redirect after success', async () => {
		const response = await post('/newsletter', { email: 'a@b.co' });

		expect(await response.json()).toMatchObject({
			redirect: '/thanks',
			status: 'success'
		});
	});
});

describe('what counts as a page action', () => {
	test('is what defineAction made', () => {
		expect(isPageAction(comment)).toBe(true);
		expect(isPageAction({ form: {}, handler: () => undefined })).toBe(
			false
		);
		expect(isPageAction(undefined)).toBe(false);
	});
});
