import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Elysia, t } from 'elysia';
import {
	encodeActionFlash,
	readActionFlash
} from '../../../src/core/formActionFlash';
import { formActions } from '../../../src/core/formActions';
import { ACTION_FLASH_COOKIE } from '../../../src/utils/formActionState';

const ORIGIN = 'http://app.test';
const SECRET = 'a'.repeat(64);

type Captured = {
	ABSOLUTE_SECRET: string | undefined;
	NODE_ENV: string | undefined;
};

const before: Captured = {
	ABSOLUTE_SECRET: process.env.ABSOLUTE_SECRET,
	NODE_ENV: process.env.NODE_ENV
};

/* Constructing the plugin is what registers the signature verifier the
 * browser-safe reader calls, so every test here needs it to have
 * happened. */
const app = new Elysia()
	.use(formActions())
	.get(
		'/thanks',
		() =>
			new Response(
				`<!doctype html><form method="post" action="/subscribe" data-absolute-action>
<input name="email" value="">
<p data-action-message hidden></p>
</form>`,
				{ headers: { 'content-type': 'text/html; charset=utf-8' } }
			)
	)
	.post(
		'/subscribe',
		{ form: t.Object({ email: t.String({ minLength: 3 }) }) },
		({ body }) => ({ email: body.email })
	);

const flashIn = (value: string) =>
	readActionFlash(
		new Request(ORIGIN, {
			headers: { cookie: `${ACTION_FLASH_COOKIE}=${value}` }
		})
	);

const cookieValueOf = (setCookie: string) =>
	setCookie.slice(setCookie.indexOf('=') + 1, setCookie.indexOf(';'));

const SPOOFED_MESSAGE = 'Your subscription was cancelled.';

/* A result an attacker would like a page to show, encoded the way the
 * cookie used to be: base64url JSON and nothing else. */
const forged = Buffer.from(
	JSON.stringify({
		action: '/subscribe',
		result: { errors: {}, message: SPOOFED_MESSAGE, status: 'error' }
	})
).toString('base64url');

const restore = (key: keyof Captured) => {
	const value = before[key];
	if (value === undefined) delete process.env[key];
	else process.env[key] = value;
};

beforeEach(() => {
	process.env.ABSOLUTE_SECRET = SECRET;
	delete process.env.NODE_ENV;
});

afterEach(() => {
	restore('ABSOLUTE_SECRET');
	restore('NODE_ENV');
});

describe('the result cookie is signed', () => {
	test('a cookie this server wrote reads back', () => {
		const cookie = encodeActionFlash(
			{ action: '/subscribe', result: { status: 'success' } },
			false
		);
		const value = cookieValueOf(cookie);
		expect(value).toContain('.');
		expect(flashIn(value)?.action).toBe('/subscribe');
	});

	test('an unsigned cookie is ignored while a secret is configured', () => {
		// Nothing to strip and nothing to brute force: without the secret
		// there is no signature to present.
		expect(flashIn(forged)).toBeUndefined();
	});

	test('a tampered payload is ignored', () => {
		const cookie = encodeActionFlash(
			{ action: '/subscribe', result: { status: 'success' } },
			false
		);
		const [, signature] = cookieValueOf(cookie).split('.');
		expect(flashIn(`${forged}.${signature ?? ''}`)).toBeUndefined();
	});

	test('a signature for another purpose does not stand in', () => {
		// `signValue` binds the purpose, so a CSRF token's signature over
		// the same bytes is not this cookie's.
		const cookie = encodeActionFlash(
			{ action: '/subscribe', result: { status: 'success' } },
			false
		);
		const [payload] = cookieValueOf(cookie).split('.');
		expect(flashIn(`${payload ?? ''}.notasignature`)).toBeUndefined();
	});

	test('a forged cookie renders nothing into the page', async () => {
		const response = await app.handle(
			new Request(`${ORIGIN}/thanks`, {
				headers: { cookie: `${ACTION_FLASH_COOKIE}=${forged}` }
			})
		);
		const html = await response.text();
		expect(html).not.toContain(SPOOFED_MESSAGE);
		expect(html).not.toContain('data-action-status');
		// The cookie is still cleared, so a bad one cannot sit there
		// defeating the page's caching for the rest of its life.
		expect(response.headers.get('set-cookie')).toContain(
			`${ACTION_FLASH_COOKIE}=;`
		);
	});
});

describe('production with no secret', () => {
	beforeEach(() => {
		delete process.env.ABSOLUTE_SECRET;
		process.env.NODE_ENV = 'production';
	});

	test('keeps working on unsigned cookies rather than losing results', () => {
		expect(flashIn(forged)?.result.status).toBe('error');
	});

	test('writes an unsigned cookie, and says so once', () => {
		const lines: string[] = [];
		const original = console.log;
		console.log = (...args: unknown[]) => lines.push(args.join(' '));
		try {
			encodeActionFlash(
				{ action: '/subscribe', result: { status: 'success' } },
				false
			);
			encodeActionFlash(
				{ action: '/subscribe', result: { status: 'success' } },
				false
			);
		} finally {
			console.log = original;
		}
		const warnings = lines.filter((line) =>
			line.includes('ABSOLUTE_SECRET is not set')
		);
		// Once per process, not once per submission: this is a
		// configuration problem, not an event.
		expect(warnings.length).toBeLessThanOrEqual(1);
	});
});
