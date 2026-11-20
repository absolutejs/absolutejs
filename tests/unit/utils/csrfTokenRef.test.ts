import { afterEach, describe, expect, test } from 'bun:test';
import {
	csrfField,
	csrfHeaders,
	readCsrfToken,
	registerCsrfTokenGetter,
	CSRF_FIELD_NAME,
	CSRF_HEADER_NAME
} from '../../../src/utils/csrfTokenRef';

const GETTER_KEY = Symbol.for('absolutejs.csrfTokenGetter');

type FakeDocument = { cookie: string };

const clear = () => {
	Reflect.deleteProperty(globalThis, GETTER_KEY);
	Reflect.deleteProperty(globalThis, 'document');
};

/* The browser fallback reads document.cookie, so these tests put a
 * stand-in document on globalThis — the same shape the real one exposes
 * for this purpose. */
const withCookie = (cookie: string) => {
	const fake: FakeDocument = { cookie };
	Reflect.set(globalThis, 'document', fake);
};

afterEach(clear);

describe('readCsrfToken', () => {
	test('the registered getter wins, so SSR uses the request token', () => {
		registerCsrfTokenGetter(() => 'from-the-request');
		withCookie('absolute_csrf=from-the-cookie');
		expect(readCsrfToken()).toBe('from-the-request');
	});

	test('without a getter it reads the cookie, which is the browser path', () => {
		withCookie('other=1; absolute_csrf=value.signature; another=2');
		expect(readCsrfToken()).toBe('value.signature');
	});

	test('no getter and no cookie means no token', () => {
		withCookie('other=1');
		expect(readCsrfToken()).toBeUndefined();
		clear();
		expect(readCsrfToken()).toBeUndefined();
	});

	test('a getter that returns nothing means no token', () => {
		registerCsrfTokenGetter(() => undefined);
		withCookie('absolute_csrf=ignored');
		expect(readCsrfToken()).toBeUndefined();
	});
});

describe('csrfField', () => {
	test('renders the hidden input a form route expects', () => {
		registerCsrfTokenGetter(() => 'value.signature');
		expect(csrfField()).toBe(
			`<input type="hidden" name="${CSRF_FIELD_NAME}" value="value.signature">`
		);
	});

	test('renders nothing without a token, so a form is unchanged', () => {
		expect(csrfField()).toBe('');
	});

	test('cannot break out of the attribute', () => {
		expect(csrfField('"><script>alert(1)</script>')).toBe(
			`<input type="hidden" name="${CSRF_FIELD_NAME}" value="&quot;><script>alert(1)</script>">`
		);
	});
});

describe('csrfHeaders', () => {
	test('names the header the server reads', () => {
		registerCsrfTokenGetter(() => 'value.signature');
		expect(csrfHeaders()).toEqual({
			[CSRF_HEADER_NAME]: 'value.signature'
		});
	});

	test('is empty without a token, so a fetch is unchanged', () => {
		expect(csrfHeaders()).toEqual({});
	});
});
