import { describe, expect, test } from 'bun:test';
import { Elysia, t } from 'elysia';
import { readActionFlash } from '../../../src/core/formActionFlash';
import { formActions } from '../../../src/core/formActions';
import { ACTION_FLASH_COOKIE } from '../../../src/utils/formActionState';

const ORIGIN = 'http://app.test';
const LIMIT = 2_000;

type Seen = { body: unknown };

const seen: Seen = { body: undefined };

const app = new Elysia().use(formActions()).post(
	'/subscribe',
	{
		form: {
			body: t.Object({
				name: t.String(),
				tags: t.Optional(t.Array(t.String()))
			}),
			maxBodySize: LIMIT
		}
	},
	({ body }) => {
		seen.body = body;

		return { ok: true };
	}
);

/* A chunked request: a stream body sends no content-length, which is what
 * the declared-size check used to be the only guard against. */
const streamed = (payload: string, chunkSize = 64) =>
	new ReadableStream<Uint8Array>({
		start(controller) {
			const bytes = new TextEncoder().encode(payload);
			for (let at = 0; at < bytes.length; at += chunkSize)
				controller.enqueue(bytes.slice(at, at + chunkSize));
			controller.close();
		}
	});

/* A stream body needs `duplex: 'half'` at runtime, which the DOM lib's
 * RequestInit does not declare; spread so it is not an excess property. */
type StreamInit = { duplex: 'half' };

const STREAM_INIT: StreamInit = { duplex: 'half' };

const postChunked = (payload: string, contentType: string) => {
	const request = new Request(`${ORIGIN}/subscribe`, {
		...STREAM_INIT,
		body: streamed(payload),
		headers: {
			'content-type': contentType,
			'sec-fetch-site': 'same-origin'
		},
		method: 'POST'
	});
	expect(request.headers.get('content-length')).toBeNull();

	return app.handle(request);
};

const postDeclared = (payload: string, contentType: string) =>
	app.handle(
		new Request(`${ORIGIN}/subscribe`, {
			body: payload,
			headers: {
				'content-type': contentType,
				'sec-fetch-site': 'same-origin'
			},
			method: 'POST'
		})
	);

const URLENCODED = 'application/x-www-form-urlencoded';

describe('maxBodySize on a body that declares no size', () => {
	test('a chunked body over the limit gets 413', async () => {
		const response = await postChunked(
			`name=${'a'.repeat(LIMIT * 2)}`,
			URLENCODED
		);
		expect(response.status).toBe(413);
	});

	test('a chunked body within the limit is accepted and parsed', async () => {
		seen.body = undefined;
		const response = await postChunked(
			'name=Ada&tags=a&tags=b',
			URLENCODED
		);
		expect(response.status).toBe(303);
		expect(seen.body).toEqual({ name: 'Ada', tags: ['a', 'b'] });
	});

	test('a declared body is still checked before anything is read', async () => {
		const response = await postDeclared(
			`name=${'a'.repeat(LIMIT * 2)}`,
			URLENCODED
		);
		expect(response.status).toBe(413);
	});

	/* The point of serving the collected bytes back through the request
	 * rather than parsing them here: Elysia stays the only parser, so a
	 * chunked body cannot arrive in a different shape from a declared one.
	 * These payloads exercise what a hand-rolled parser would get wrong —
	 * repeated keys, a comma, a plus, a percent escape, an empty value. */
	test('chunked and declared bodies parse identically', async () => {
		const payloads = [
			'name=Ada&tags=a&tags=b',
			'name=Ada+Lovelace&tags=one%2Ctwo',
			'name=a%20b&tags=',
			'name=%E2%9C%93'
		];
		// Sequentially: the handler records into one shared slot, so
		// concurrent submissions would read each other's.
		const results: { chunked: unknown; declared: unknown }[] = [];
		await payloads.reduce(async (previous, payload) => {
			await previous;
			seen.body = undefined;
			await postDeclared(payload, URLENCODED);
			const declared = seen.body;
			seen.body = undefined;
			await postChunked(payload, URLENCODED);
			results.push({ chunked: seen.body, declared });
		}, Promise.resolve());
		results.forEach(({ chunked, declared }) => {
			expect(chunked).toEqual(declared);
		});
		// And the shapes are real, not both undefined.
		expect(results[0]?.declared).toEqual({
			name: 'Ada',
			tags: ['a', 'b']
		});
	});

	test('a chunked multipart body is accepted and parsed', async () => {
		const boundary = 'absolutejstest';
		const payload = [
			`--${boundary}`,
			'Content-Disposition: form-data; name="name"',
			'',
			'Ada',
			`--${boundary}--`,
			''
		].join('\r\n');
		seen.body = undefined;
		const response = await postChunked(
			payload,
			`multipart/form-data; boundary=${boundary}`
		);
		expect(response.status).toBe(303);
		// `tags` is absent from the payload; the form normaliser fills an
		// optional array with [] before validation.
		expect(seen.body).toEqual({ name: 'Ada', tags: [] });
	});

	test('a request with no body at all is left alone', async () => {
		const response = await app.handle(
			new Request(`${ORIGIN}/subscribe`, {
				headers: { 'sec-fetch-site': 'same-origin' },
				method: 'POST'
			})
		);
		// There is nothing to read and so nothing to cap. What such a
		// request *should* answer is a separate question: today it reaches
		// the handler with an undefined body rather than a 422, which this
		// test deliberately does not pin down.
		expect(response.status).not.toBe(413);
	});
});

/* ---------------------------------------------------------------- *
 * A submission with nothing to parse
 * ---------------------------------------------------------------- */

const errorsApp = new Elysia()
	.use(formActions())
	.post(
		'/subscribe',
		{ form: t.Object({ name: t.String({ minLength: 2 }) }) },
		({ body }) => ({ seen: body.name })
	);

const resultOf = async (response: Response) => {
	const cookie = response.headers
		.getSetCookie()
		.find((entry) => entry.startsWith(`${ACTION_FLASH_COOKIE}=`));

	return cookie
		? readActionFlash(
				new Request(ORIGIN, {
					headers: { cookie: cookie.split(';')[0] ?? '' }
				})
			)?.result
		: undefined;
};

describe('a submission with no content-type', () => {
	test('reports its errors per field, not against the whole body', async () => {
		const response = await errorsApp.handle(
			new Request(`${ORIGIN}/subscribe`, {
				headers: { 'sec-fetch-site': 'same-origin' },
				method: 'POST'
			})
		);
		// Not `{ '': 'must be object' }`: a form shows errors next to
		// fields, and `must be object` is the validator talking to itself.
		expect(await resultOf(response)).toEqual({
			errors: { name: 'Required' },
			status: 'error'
		});
	});

	test('a declared form body still parses normally', async () => {
		const response = await errorsApp.handle(
			new Request(`${ORIGIN}/subscribe`, {
				body: 'name=Ada',
				headers: {
					'content-type': URLENCODED,
					'sec-fetch-site': 'same-origin'
				},
				method: 'POST'
			})
		);
		expect(await resultOf(response)).toEqual({
			data: { seen: 'Ada' },
			status: 'success'
		});
	});
});
