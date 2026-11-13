import { describe, expect, test } from 'bun:test';
import { Elysia, t } from 'elysia';
import type {
	ActionFields,
	ActionPath,
	ActionStateOf
} from '../../../types/formAction';
import {
	ACTION_FLASH_COOKIE,
	encodeActionFlash,
	formActionRuntime,
	readActionFlash
} from '../../../src/core/formActionFlash';
import {
	defineAction,
	getActionState,
	isCrossOriginRequest
} from '../../../src/core/formActions';
import { ACTION_REQUEST_HEADER } from '../../../src/utils/formActionProtocol';

const ORIGIN = 'http://app.test';

const createUser = defineAction('/users', {
	body: t.Object({
		age: t.Optional(t.Number()),
		email: t.String({ error: 'Enter an email address', format: 'email' }),
		name: t.String({ minLength: 2 }),
		newsletter: t.Boolean(),
		password: t.Optional(t.String()),
		tags: t.Array(t.String())
	}),
	handler: ({ body, fail }) => {
		if (body.name === 'taken')
			return fail({ name: 'That name is taken' }, 'Fix the errors');

		return {
			id: 7,
			name: body.name,
			newsletter: body.newsletter,
			tags: body.tags
		};
	}
});

const redirecting = defineAction('/redirecting', {
	body: t.Object({ name: t.String() }),
	handler: ({ body }) => ({ name: body.name }),
	redirect: (data) => `/users/${data.name}`
});

const htmxFragment = defineAction('/fragment', {
	body: t.Object({ name: t.String({ minLength: 2 }) }),
	handler: ({ body }) => ({ name: body.name }),
	htmx: (result) =>
		result.status === 'success'
			? `<p id="ok">Hi ${result.data?.name}</p>`
			: `<p id="bad">${result.errors.name}</p>`
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
<script>window.state = ${JSON.stringify(getActionState(createUser, request) ?? null)}</script>
</body></html>`,
		{ headers: { 'content-type': 'text/html; charset=utf-8' } }
	);

const app = new Elysia()
	.use(formActionRuntime())
	.get('/signup', ({ request }) => page(request))
	.get('/data', () => ({ ok: true }))
	.use(createUser)
	.use(redirecting)
	.use(htmxFragment);

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

const post = (
	path: string,
	body: BodyInit,
	headers: Record<string, string> = {}
) => {
	const contentType = contentTypeOf(body);

	return app.handle(
		new Request(`${ORIGIN}${path}`, {
			body,
			headers: {
				...(contentType ? { 'content-type': contentType } : {}),
				referer: `${ORIGIN}/signup?step=1`,
				'sec-fetch-site': 'same-origin',
				...headers
			},
			method: 'POST'
		})
	);
};

const flashCookieOf = (response: Response) => {
	const cookie = response.headers.get('set-cookie') ?? '';

	return cookie.split(';')[0] ?? '';
};

describe('defineAction — JSON (browser helpers)', () => {
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

describe('defineAction — without JavaScript', () => {
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
		const flash = readActionFlash(
			new Request(ORIGIN, {
				headers: { cookie: flashCookieOf(response) }
			})
		);
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

describe('defineAction — HTMX', () => {
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

describe('defineAction — protection', () => {
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
		const small = defineAction('/small', {
			body: t.Object({ name: t.String() }),
			maxBodySize: 10,
			handler: () => ({ ok: true })
		});
		const response = await new Elysia().use(small).handle(
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

/* Type-level checks: these fail `tsc`, not the run. */
type CreateUser = typeof createUser;
const pathCheck: ActionPath<CreateUser> = '/users';
const fieldCheck: ActionFields<CreateUser> = 'email';
const stateCheck: ActionStateOf<CreateUser> = {
	errors: { email: 'x' },
	status: 'error'
};
// @ts-expect-error — not a field of the schema
const badField: ActionFields<CreateUser> = 'nope';
void [pathCheck, fieldCheck, stateCheck, badField];
