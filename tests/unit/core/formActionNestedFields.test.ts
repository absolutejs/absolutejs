import { describe, expect, test } from 'bun:test';
import { Elysia, t } from 'elysia';
import {
	encodeActionFlash,
	readActionFlash
} from '../../../src/core/formActionFlash';
import { formActions } from '../../../src/core/formActions';
import { ACTION_FLASH_COOKIE } from '../../../src/utils/formActionState';

/* A form sends one flat list of names, so a nested body is spelled into
 * them: `address.city`, `items[0].sku`. These prove the body arrives
 * shaped the way the schema declares it, and that a failure is reported
 * against the name the input actually has — otherwise the message has no
 * field to appear next to. */

const ORIGIN = 'http://app.test';

type Seen = { body: unknown };

const seen: Seen = { body: undefined };

const app = new Elysia().use(formActions()).post(
	'/order',
	{
		form: t.Object({
			address: t.Object({
				city: t.String({ error: 'Enter a city', minLength: 2 }),
				zip: t.String()
			}),
			items: t.Array(
				t.Object({
					gift: t.Boolean(),
					qty: t.Number(),
					sku: t.String()
				})
			),
			notify: t.Boolean()
		})
	},
	({ body }) => {
		seen.body = body;

		return { ok: true };
	}
);

const post = async (payload: string) => {
	seen.body = undefined;
	const response = await app.handle(
		new Request(`${ORIGIN}/order`, {
			body: payload,
			headers: {
				'content-type': 'application/x-www-form-urlencoded',
				'sec-fetch-site': 'same-origin'
			},
			method: 'POST'
		})
	);
	const cookie = response.headers
		.getSetCookie()
		.find((entry) => entry.startsWith(`${ACTION_FLASH_COOKIE}=`));
	const flash = cookie
		? readActionFlash(
				new Request(ORIGIN, {
					headers: { cookie: cookie.split(';')[0] ?? '' }
				})
			)
		: undefined;

	return { body: seen.body, result: flash?.result };
};

const VALID = [
	'address.city=Paris',
	'address.zip=75001',
	'items[0].sku=abc',
	'items[0].qty=2',
	'items[1].sku=xyz',
	'items[1].qty=1',
	'items[1].gift=on',
	'notify=on'
].join('&');

describe('a nested form body', () => {
	test('arrives shaped the way the schema declares it', async () => {
		const { body, result } = await post(VALID);
		expect(result?.status).toBe('success');
		expect(body).toEqual({
			address: { city: 'Paris', zip: '75001' },
			items: [
				// A checkbox that was not ticked sends nothing, and still
				// has to arrive as false two levels down.
				{ gift: false, qty: 2, sku: 'abc' },
				{ gift: true, qty: 1, sku: 'xyz' }
			],
			notify: true
		});
	});

	test('accepts dots around an index as well as brackets', async () => {
		const { body, result } = await post(
			'address.city=Paris&address.zip=1&items.0.sku=abc&items.0.qty=2'
		);
		expect(result?.status).toBe('success');
		expect(body).toEqual({
			address: { city: 'Paris', zip: '1' },
			items: [{ gift: false, qty: 2, sku: 'abc' }],
			notify: false
		});
	});

	test('reports a nested failure against the input that holds it', async () => {
		const { result } = await post(VALID.replace('city=Paris', 'city=P'));
		expect(result?.status).toBe('error');
		expect(result?.status === 'error' ? result.errors : {}).toEqual({
			// The property's own `error` message, keyed by the field name.
			'address.city': 'Enter a city'
		});
	});

	test('reports a missing nested field by its full path', async () => {
		const { result } = await post(
			VALID.split('&')
				.filter((pair) => !pair.startsWith('address.city'))
				.join('&')
		);
		// Not `city`: that would never match an input named address.city.
		expect(result?.status === 'error' ? result.errors : {}).toEqual({
			'address.city': 'Enter a city'
		});
	});

	test('reports a failure inside an array entry by its index', async () => {
		const { result } = await post(VALID.replace('items[1].qty=1', ''));
		expect(result?.status === 'error' ? result.errors : {}).toEqual({
			'items[1].qty': 'Required'
		});
	});

	test('echoes the values under the names the inputs had', async () => {
		const { result } = await post(VALID.replace('city=Paris', 'city=P'));
		const values = result?.status === 'error' ? result.values : undefined;
		// The re-rendered page matches these against `name`, so they stay
		// as submitted rather than following the body's new shape.
		expect(values?.['address.city']).toBe('P');
		expect(values?.['items[0].sku']).toBe('abc');
	});

	test('leaves a name the schema does not declare alone', async () => {
		// Expansion is driven by the schema, so an unknown path cannot
		// create anything; the submission is answered as before.
		const { body, result } = await post(`${VALID}&address.country=FR`);
		expect(result?.status).toBe('success');
		expect(body).toEqual({
			address: { city: 'Paris', zip: '75001' },
			items: [
				{ gift: false, qty: 2, sku: 'abc' },
				{ gift: true, qty: 1, sku: 'xyz' }
			],
			notify: true
		});
	});

	test('a name reaching for the prototype chain does nothing', async () => {
		const { result } = await post(
			`${VALID}&__proto__.polluted=1&constructor.prototype.polluted=1`
		);
		expect(result?.status).toBe('success');
		expect(Reflect.get(Object.prototype, 'polluted')).toBeUndefined();
		expect(Reflect.get({}, 'polluted')).toBeUndefined();
	});

	test('a sparse index does not leave holes in the array', async () => {
		// A browser submits contiguous indices; a hand-built body need
		// not, and a hole would validate as a missing object.
		const { body, result } = await post(
			'address.city=Paris&address.zip=1&items[2].sku=abc&items[2].qty=2'
		);
		expect(result?.status).toBe('success');
		expect(body).toEqual({
			address: { city: 'Paris', zip: '1' },
			items: [{ gift: false, qty: 2, sku: 'abc' }],
			notify: false
		});
	});

	test('the re-rendered page shows the error and value on the nested input', async () => {
		// The whole no-JavaScript path: the rewriter matches inputs by the
		// name they were submitted under, which is why the echoed values
		// stay flat.
		const page = new Elysia().use(formActions()).get(
			'/checkout',
			() =>
				new Response(
					`<!doctype html><html><body>
<form method="post" action="/order" data-absolute-action>
<input name="address.city" value="">
<p data-action-error="address.city" hidden></p>
<input name="items[0].sku" value="">
</form>
</body></html>`,
					{
						headers: {
							'content-type': 'text/html; charset=utf-8'
						}
					}
				)
		);
		const submission = await post(VALID.replace('city=Paris', 'city=P'));
		const flash = submission.result;
		expect(flash?.status).toBe('error');
		const cookie = encodeActionFlash(
			{ action: '/order', result: flash ?? { status: 'success' } },
			false
		);
		const rendered = await page.handle(
			new Request(`${ORIGIN}/checkout`, {
				headers: { cookie: cookie.slice(0, cookie.indexOf(';')) }
			})
		);
		const html = await rendered.text();
		expect(html).toContain(
			'<p data-action-error="address.city">Enter a city</p>'
		);
		// The value the visitor typed, kept on the nested input, and the
		// field marked invalid for a screen reader.
		expect(html).toContain(
			'<input name="address.city" value="P" aria-invalid="true">'
		);
		// A field inside an array entry is restored too.
		expect(html).toContain('<input name="items[0].sku" value="abc">');
	});

	test('a flat form is unaffected', async () => {
		const flat = new Elysia().use(formActions()).post(
			'/flat',
			{
				form: t.Object({
					name: t.String({ minLength: 2 }),
					tags: t.Array(t.String())
				})
			},
			({ body }) => ({ ...body })
		);
		const response = await flat.handle(
			new Request(`${ORIGIN}/flat`, {
				body: 'name=Ada&tags=a&tags=b',
				headers: {
					'content-type': 'application/x-www-form-urlencoded',
					'sec-fetch-site': 'same-origin'
				},
				method: 'POST'
			})
		);
		expect(response.status).toBe(303);
	});
});
