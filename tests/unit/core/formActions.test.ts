import { describe, expect, test } from 'bun:test';
import { Elysia, t } from 'elysia';
import type {
	ActionResult,
	ActionState,
	FormActionFailure,
	FormActionFieldsOf,
	FormActionPaths,
	FormActionStateOf
} from '../../../types/formAction';
import { createFormActionClient } from '../../../src/client/formActionClient';
import {
	ACTION_FLASH_COOKIE,
	encodeActionFlash,
	readActionFlash
} from '../../../src/core/formActionFlash';
import {
	formActions,
	getActionState,
	isCrossOriginRequest
} from '../../../src/core/formActions';
import { ACTION_REQUEST_HEADER } from '../../../src/utils/formActionProtocol';

const ORIGIN = 'http://app.test';

const userForm = t.Object({
	age: t.Optional(t.Number()),
	email: t.String({ error: 'Enter an email address', format: 'email' }),
	name: t.String({ minLength: 2 }),
	newsletter: t.Boolean(),
	password: t.Optional(t.String()),
	tags: t.Array(t.String())
});

const page = (request: Request) =>
	new Response(
		`<!doctype html><html><body>
<form method="post" action="/users" data-absolute-action>
<input name="name" value="">
<p data-action-error="name" hidden></p>
<input name="email" type="email">
<p data-action-error="email" hidden></p>
<input name="password" type="password">
<input name="newsletter" type="checkbox">
<select name="tags" multiple><option value="a">A</option><option value="b">B</option></select>
<textarea name="bio"></textarea>
<p data-action-message hidden></p>
<p data-action-success hidden>Saved</p>
</form>
<form method="post" action="/other" data-absolute-action><input name="name"></form>
<script>window.state = ${JSON.stringify(getActionState('/users', request) ?? null)}</script>
</body></html>`,
		{ headers: { 'content-type': 'text/html; charset=utf-8' } }
	);

const app = new Elysia()
	.use(formActions())
	.get('/signup', ({ request }) => page(request))
	.get('/data', () => ({ ok: true }))
	.post('/users', { form: userForm }, ({ body, fail }) => {
		if (body.name === 'taken')
			return fail({ name: 'That name is taken' }, 'Fix the errors');

		return {
			id: 7,
			name: body.name,
			newsletter: body.newsletter,
			tags: body.tags
		};
	})
	.post(
		'/redirecting',
		{
			form: {
				body: t.Object({ name: t.String() }),
				redirect: (data: { name: string }) => `/users/${data.name}`
			}
		},
		({ body }) => ({ name: body.name })
	)
	.post(
		'/fragment',
		{
			form: {
				body: t.Object({ name: t.String({ minLength: 2 }) }),
				htmx: (result: ActionResult<{ name: string }, 'name'>) =>
					result.status === 'success'
						? `<p id="ok">Hi ${result.data?.name}</p>`
						: `<p id="bad">${result.errors.name}</p>`
			}
		},
		({ body }) => ({ name: body.name })
	);

const form = (entries: [string, string][]) => {
	const body = new URLSearchParams();
	entries.forEach(([key, value]) => body.append(key, value));

	return body;
};

const contentTypeOf = (body: BodyInit) => {
	if (typeof body === 'string') return 'application/json';
	if (body instanceof URLSearchParams)
		return 'application/x-www-form-urlencoded';

	return undefined;
};

const requestTo = (
	path: string,
	body: BodyInit,
	headers: Record<string, string> = {}
) => {
	const contentType = contentTypeOf(body);

	return new Request(`${ORIGIN}${path}`, {
		body,
		headers: {
			...(contentType ? { 'content-type': contentType } : {}),
			referer: `${ORIGIN}/signup?step=1`,
			'sec-fetch-site': 'same-origin',
			...headers
		},
		method: 'POST'
	});
};

const post = (
	path: string,
	body: BodyInit,
	headers: Record<string, string> = {}
) => app.handle(requestTo(path, body, headers));

const flashCookieOf = (response: Response) => {
	const cookie = response.headers.get('set-cookie') ?? '';

	return cookie.split(';')[0] ?? '';
};

const flashOf = (response: Response) =>
	readActionFlash(
		new Request(ORIGIN, { headers: { cookie: flashCookieOf(response) } })
	);

describe('form routes — JSON (browser helpers)', () => {
	test('success returns the typed data', async () => {
		const response = await post(
			'/users',
			form([
				['name', 'Ada'],
				['email', 'ada@example.com'],
				['newsletter', 'on'],
				['tags', 'a']
			]),
			{ [ACTION_REQUEST_HEADER]: '1' }
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			data: { id: 7, name: 'Ada', newsletter: true, tags: ['a'] },
			status: 'success'
		});
	});

	test('validation errors come back one per field, custom messages first', async () => {
		const response = await post(
			'/users',
			form([
				['name', 'A'],
				['email', 'nope'],
				['age', '']
			]),
			{ [ACTION_REQUEST_HEADER]: '1' }
		);
		// The browser helpers get 200 (no console noise); JSON clients 422.
		expect(response.status).toBe(200);
		const result = await response.json();
		expect(result.status).toBe('error');
		expect(result.errors.email).toBe('Enter an email address');
		expect(result.errors.name).toContain('2');
		// unchecked checkbox → false, missing array → [], empty number → absent
		expect(result.errors.newsletter).toBeUndefined();
		expect(result.errors.tags).toBeUndefined();
		expect(result.errors.age).toBeUndefined();
	});

	test('number inputs are read as numbers', async () => {
		const valid = await post(
			'/users',
			form([
				['name', 'Ada'],
				['email', 'ada@example.com'],
				['age', '42']
			]),
			{ [ACTION_REQUEST_HEADER]: '1' }
		);
		expect((await valid.json()).status).toBe('success');
		const invalid = await post(
			'/users',
			form([
				['name', 'Ada'],
				['email', 'ada@example.com'],
				['age', 'forty']
			]),
			{ [ACTION_REQUEST_HEADER]: '1' }
		);
		const result = await invalid.json();
		expect(Object.keys(result.errors)).toEqual(['age']);
	});

	test('missing required fields say Required', async () => {
		const response = await post('/users', JSON.stringify({ tags: [] }));
		expect(response.status).toBe(422);
		const result = await response.json();
		expect(result.errors.name).toBe('Required');
		expect(result.errors.email).toBe('Enter an email address');
	});

	test('fail() returns field errors and a message', async () => {
		const response = await post(
			'/users',
			JSON.stringify({
				email: 'a@b.co',
				name: 'taken',
				newsletter: false,
				tags: []
			})
		);
		expect(response.status).toBe(422);
		expect(await response.json()).toEqual({
			errors: { name: 'That name is taken' },
			message: 'Fix the errors',
			status: 'error'
		});
	});

	test('redirect is reported to the browser helpers', async () => {
		const response = await post('/redirecting', form([['name', 'ada']]), {
			[ACTION_REQUEST_HEADER]: '1'
		});
		expect(await response.json()).toEqual({
			data: { name: 'ada' },
			redirect: '/users/ada',
			status: 'success'
		});
	});
});

describe('form routes — without JavaScript', () => {
	test('error: 303 back to the page with the result in a cookie', async () => {
		const response = await post(
			'/users',
			form([
				['name', 'A'],
				['email', 'nope'],
				['password', 'hunter2'],
				['tags', 'b']
			])
		);
		expect(response.status).toBe(303);
		expect(response.headers.get('location')).toBe('/signup?step=1');
		const setCookie = response.headers.get('set-cookie') ?? '';
		expect(setCookie).toContain('HttpOnly');
		expect(setCookie).toContain('SameSite=Lax');
		const flash = flashOf(response);
		expect(flash?.action).toBe('/users');
		expect(flash?.result.status).toBe('error');
		if (flash?.result.status !== 'error') return;
		expect(flash.result.values).toEqual({
			email: 'nope',
			name: 'A',
			tags: 'b'
		});
	});

	test('success: 303 to the redirect target', async () => {
		const response = await post('/redirecting', form([['name', 'ada']]));
		expect(response.status).toBe(303);
		expect(response.headers.get('location')).toBe('/users/ada');
	});

	test('a cross-site referer never becomes the redirect target', async () => {
		const response = await post('/users', form([['name', 'A']]), {
			referer: 'https://evil.test/phish'
		});
		expect(response.headers.get('location')).toBe('/');
	});

	test('the next HTML page renders the result into the matching form and clears the cookie', async () => {
		const posted = await post(
			'/users',
			form([
				['name', 'A'],
				['email', 'nope'],
				['newsletter', 'on'],
				['tags', 'b'],
				['bio', 'hello <b>']
			])
		);
		const response = await app.handle(
			new Request(`${ORIGIN}/signup`, {
				headers: { cookie: flashCookieOf(posted) }
			})
		);
		const html = await response.text();
		expect(response.headers.get('set-cookie')).toContain(
			`${ACTION_FLASH_COOKIE}=; Path=/; Max-Age=0`
		);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(html).toContain('data-action-status="error"');
		expect(html).toContain(
			'<input name="name" value="A" aria-invalid="true">'
		);
		expect(html).toContain(
			'<p data-action-error="email">Enter an email address</p>'
		);
		expect(html).toContain(
			'<input name="newsletter" type="checkbox" checked="">'
		);
		expect(html).toContain('<option value="b" selected="">');
		expect(html).toContain(
			'<textarea name="bio">hello &lt;b&gt;</textarea>'
		);
		expect(html).toContain('<input name="password" type="password">');
		// the other form is untouched
		expect(html).toContain(
			'<form method="post" action="/other" data-absolute-action><input name="name"></form>'
		);
		// and the route saw it through getActionState
		expect(html).toContain('"status":"error"');
	});

	test('non-HTML responses leave the cookie alone', async () => {
		const response = await app.handle(
			new Request(`${ORIGIN}/data`, {
				headers: {
					cookie:
						encodeActionFlash(
							{ action: '/users', result: { status: 'success' } },
							false
						).split(';')[0] ?? ''
				}
			})
		);
		expect(response.headers.get('set-cookie')).toBeNull();
	});

	test('success shows the success element', async () => {
		const posted = await post(
			'/users',
			form([
				['name', 'Ada'],
				['email', 'ada@example.com']
			])
		);
		expect(posted.headers.get('location')).toBe('/signup?step=1');
		const html = await (
			await app.handle(
				new Request(`${ORIGIN}/signup`, {
					headers: { cookie: flashCookieOf(posted) }
				})
			)
		).text();
		expect(html).toContain('data-action-status="success"');
		expect(html).toContain('<p data-action-success>Saved</p>');
	});
});

describe('form routes — HTMX', () => {
	test('fragment renders the result', async () => {
		const ok = await post('/fragment', form([['name', 'Ada']]), {
			'hx-request': 'true'
		});
		expect(ok.status).toBe(200);
		expect(await ok.text()).toBe('<p id="ok">Hi Ada</p>');
		const bad = await post('/fragment', form([['name', 'A']]), {
			'hx-request': 'true'
		});
		expect(bad.status).toBe(200);
		expect(await bad.text()).toContain('<p id="bad">');
	});

	test('without a fragment, HX-Redirect does what a plain post does', async () => {
		const response = await post('/users', form([['name', 'A']]), {
			'hx-current-url': `${ORIGIN}/signup`,
			'hx-request': 'true'
		});
		expect(response.status).toBe(200);
		expect(response.headers.get('hx-redirect')).toBe('/signup');
		expect(response.headers.get('set-cookie')).toContain(
			`${ACTION_FLASH_COOKIE}=`
		);
	});
});

describe('form routes — protection', () => {
	test('cross-site posts are rejected before the body is read', async () => {
		const response = await post('/users', form([['name', 'Ada']]), {
			'sec-fetch-site': 'cross-site'
		});
		expect(response.status).toBe(403);
	});

	test('Origin is compared with Host when Sec-Fetch-Site is absent', () => {
		const make = (headers: Record<string, string>) =>
			new Request(`${ORIGIN}/users`, { headers, method: 'POST' });
		expect(
			isCrossOriginRequest(
				make({ host: 'app.test', origin: 'http://app.test' })
			)
		).toBe(false);
		expect(
			isCrossOriginRequest(
				make({ host: 'app.test', origin: 'https://evil.test' })
			)
		).toBe(true);
		expect(isCrossOriginRequest(make({}))).toBe(false);
		expect(
			isCrossOriginRequest(
				make({
					origin: 'https://admin.test',
					'sec-fetch-site': 'cross-site'
				}),
				['https://admin.test']
			)
		).toBe(false);
	});

	test('declared bodies over maxBodySize get 413', async () => {
		const small = new Elysia().use(formActions()).post(
			'/small',
			{
				form: {
					body: t.Object({ name: t.String() }),
					maxBodySize: 10
				}
			},
			() => ({ ok: true })
		);
		const response = await small.handle(
			new Request(`${ORIGIN}/small`, {
				body: form([['name', 'a much longer value than ten bytes']]),
				headers: {
					'content-length': '40',
					'content-type': 'application/x-www-form-urlencoded',
					'x-absolute-action': '1'
				},
				method: 'POST'
			})
		);
		expect(response.status).toBe(413);
	});
});

/* ---------------------------------------------------------------- *
 * The options shape: `form: { body, …options }`
 * ---------------------------------------------------------------- */

const optionsApp = new Elysia()
	.use(formActions())
	.post(
		'/open',
		{ form: { body: t.Object({ name: t.String() }), csrf: false } },
		({ body }) => ({ name: body.name })
	)
	.post(
		'/partner',
		{
			form: {
				body: t.Object({ name: t.String() }),
				csrf: { trustedOrigins: ['https://partner.test'] }
			}
		},
		({ body }) => ({ name: body.name })
	)
	.post(
		'/private',
		{
			form: {
				body: t.Object({ name: t.String({ minLength: 2 }) }),
				preserveValues: false
			}
		},
		({ body }) => ({ name: body.name })
	)
	.post(
		'/items/:id',
		{ form: t.Object({ title: t.String({ minLength: 2 }) }) },
		({ body, params }) => ({ id: params.id, title: body.title })
	);

const postOptions = (
	path: string,
	body: BodyInit,
	headers: Record<string, string> = {}
) => optionsApp.handle(requestTo(path, body, headers));

describe('form routes — options', () => {
	test('csrf: false accepts a cross-site post', async () => {
		const response = await postOptions('/open', form([['name', 'Ada']]), {
			[ACTION_REQUEST_HEADER]: '1',
			'sec-fetch-site': 'cross-site'
		});
		expect(response.status).toBe(200);
		expect((await response.json()).status).toBe('success');
	});

	test('csrf.trustedOrigins accepts those origins only', async () => {
		const trusted = await postOptions('/partner', form([['name', 'Ada']]), {
			[ACTION_REQUEST_HEADER]: '1',
			origin: 'https://partner.test',
			'sec-fetch-site': 'cross-site'
		});
		expect(trusted.status).toBe(200);
		const other = await postOptions('/partner', form([['name', 'Ada']]), {
			[ACTION_REQUEST_HEADER]: '1',
			origin: 'https://evil.test',
			'sec-fetch-site': 'cross-site'
		});
		expect(other.status).toBe(403);
	});

	test('preserveValues: false leaves the typed values out of the cookie', async () => {
		const response = await postOptions('/private', form([['name', 'A']]));
		expect(response.status).toBe(303);
		const flash = flashOf(response);
		expect(flash?.result.status).toBe('error');
		if (flash?.result.status !== 'error') return;
		expect(flash.result.values).toBeUndefined();
		expect(flash.result.errors.name).toBeDefined();
	});

	test('a route with path parameters is found by its pattern or its path', async () => {
		const response = await postOptions('/items/3', form([['title', 'A']]));
		expect(response.status).toBe(303);
		const flash = flashOf(response);
		expect(flash?.action).toBe('/items/3');
		const next = new Request(`${ORIGIN}/items/3/edit`, {
			headers: { cookie: flashCookieOf(response) }
		});
		expect(getActionState('/items/:id', next)?.status).toBe('error');
		expect(getActionState('/items/3', next)?.status).toBe('error');
		expect(getActionState('/items/4', next)).toBeUndefined();
	});

	test('a JSON client (Eden, fetch) gets the handler data with 200', async () => {
		const response = await postOptions(
			'/items/9',
			JSON.stringify({ title: 'Hello' })
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ id: '9', title: 'Hello' });
	});
});

/* ---------------------------------------------------------------- *
 * Compile-time: what the handler, Eden and the typed client see. The
 * file failing to compile is the test; each case keeps one runtime
 * expect so it counts.
 * ---------------------------------------------------------------- */

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? true
		: false;

const signedIn: { id: number; name: string } = { id: 1, name: 'Grace' };
const auth = new Elysia({ name: 'test-auth' }).derive('global', () => ({
	user: signedIn
}));

const typed = new Elysia()
	.use(auth)
	.use(formActions())
	.post(
		'/greet',
		{ form: t.Object({ name: t.String({ minLength: 2 }) }) },
		({ body, fail, user }) => {
			const userCheck: Equal<typeof user, { id: number; name: string }> =
				true;
			void userCheck;

			return body.name === 'taken'
				? fail({ name: 'That name is taken' })
				: { by: user.name, greeting: `Welcome, ${body.name}` };
		}
	)
	.post(
		'/subscribe',
		{
			form: {
				body: t.Object({ email: t.String(), weekly: t.Boolean() }),
				preserveValues: false,
				redirect: '/thanks'
			}
		},
		({ body, fail }) =>
			body.email === 'taken'
				? fail({ email: 'Already subscribed' })
				: { email: body.email }
	)
	.post(
		'/typo',
		{ form: t.Object({ name: t.String() }) },
		// @ts-expect-error — `nope` is not a field of the form
		({ fail }) => fail({ nope: 'x' })
	)
	.post('/plain', ({ body }) => ({ body }));

type TypedRoutes = (typeof typed)['~Routes'];
type GreetRoute = TypedRoutes['greet']['post'];
type SubscribeRoute = TypedRoutes['subscribe']['post'];

describe('form route types (what the handler and Eden see)', () => {
	test('a JSON client gets the typed 422 body', async () => {
		const response = await typed.handle(
			new Request(`${ORIGIN}/greet`, {
				body: JSON.stringify({ name: 'taken' }),
				headers: { 'content-type': 'application/json' },
				method: 'POST'
			})
		);
		expect(response.status).toBe(422);
		expect(await response.json()).toEqual({
			errors: { name: 'That name is taken' },
			status: 'error'
		});
	});

	test('the body is typed from the form schema', () => {
		const check: Equal<GreetRoute['body'], { name: string }> = true;
		const options: Equal<
			SubscribeRoute['body'],
			{ email: string; weekly: boolean }
		> = true;
		expect([check, options]).toEqual([true, true]);
	});

	test('success is the handler data, with the derived user typed', () => {
		const check: Equal<
			GreetRoute['response'][200],
			{ by: string; greeting: string }
		> = true;
		expect(check).toBe(true);
	});

	test('the 422 is only the field-error shape, keyed by the schema fields', () => {
		const greet: Equal<
			GreetRoute['response'][422],
			FormActionFailure<'name'>
		> = true;
		const subscribe: Equal<
			SubscribeRoute['response'][422],
			FormActionFailure<'email' | 'weekly'>
		> = true;
		const statuses: Equal<keyof GreetRoute['response'], 200 | 422> = true;
		expect([greet, subscribe, statuses]).toEqual([true, true, true]);
	});

	test('no status of the route is typed as a raw Response', () => {
		type HasResponse = Extract<
			GreetRoute['response'][keyof GreetRoute['response']],
			Response
		>;
		const check: Equal<HasResponse, never> = true;
		expect(check).toBe(true);
	});
});

const actions = createFormActionClient<typeof typed>();
describe('createFormActionClient (typed by path)', () => {
	test('only POST routes that use `form` are paths', () => {
		const check: Equal<
			FormActionPaths<typeof typed>,
			'/greet' | '/subscribe' | '/typo'
		> = true;
		// @ts-expect-error — not a route of the app
		const unknownPath = () => actions.getActionState('/nope');
		// @ts-expect-error — a POST route without `form`
		const plainPath = () => actions.getActionState('/plain');
		void [unknownPath, plainPath];
		expect(check).toBe(true);
	});

	test('state, data and fields are typed from the route', () => {
		const state: Equal<
			FormActionStateOf<typeof typed, '/greet'>,
			ActionState<{ by: string; greeting: string }, 'name'>
		> = true;
		const fields: Equal<
			FormActionFieldsOf<typeof typed, '/subscribe'>,
			'email' | 'weekly'
		> = true;
		const returned: Equal<
			ReturnType<typeof actions.getActionState<'/greet'>>,
			ActionResult<{ by: string; greeting: string }, 'name'> | undefined
		> = true;
		expect([state, fields, returned]).toEqual([true, true, true]);
	});

	test('getActionState reads the result of a submission without JavaScript', async () => {
		const posted = await typed.handle(
			requestTo('/subscribe', form([['email', 'taken']]))
		);
		expect(posted.status).toBe(303);
		const next = new Request(`${ORIGIN}/thanks`, {
			headers: { cookie: flashCookieOf(posted) }
		});
		const state = actions.getActionState('/subscribe', next);
		expect(state?.status).toBe('error');
		if (state?.status !== 'error') return;
		expect(state.errors.email).toBe('Already subscribed');
		expect(state.values).toBeUndefined();
		expect(actions.getActionState('/greet', next)).toBeUndefined();
	});
});
