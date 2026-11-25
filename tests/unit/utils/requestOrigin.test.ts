import { describe, expect, test } from 'bun:test';
import {
	isProxyTrusted,
	requestHost,
	requestOrigin
} from '../../../src/utils/requestOrigin';

/* The host and origin the browser used. Behind a proxy that is not what
 * this process was reached on, and the two halves are not alike: the
 * scheme is safe to believe from anyone, the host is not.
 *
 *   shape                          Host         forwarded      wanted
 *   direct                         example.com  —              example.com
 *   proxy that keeps Host          example.com  —              example.com
 *   proxy that rewrites Host       app:3000     example.com    example.com  (trusted)
 *   a client sending its own       example.com  evil.test      example.com  (not trusted)
 */

const request = (url: string, headers: Record<string, string> = {}) =>
	new Request(url, { headers });

describe('requestHost', () => {
	test('is the Host header on a direct request', () => {
		expect(
			requestHost(
				request('http://example.com/a', { host: 'example.com' })
			)
		).toBe('example.com');
	});

	test('falls back to the URL when there is no Host header', () => {
		expect(requestHost(request('http://example.com:8080/a'), false)).toBe(
			'example.com:8080'
		);
	});

	test('behind a trusted proxy, is the forwarded host', () => {
		expect(
			requestHost(
				request('http://app:3000/a', {
					host: 'app:3000',
					'x-forwarded-host': 'example.com'
				}),
				true
			)
		).toBe('example.com');
	});

	/* The reason there is a setting at all. */
	test('a forwarded host is ignored unless the proxy is trusted', () => {
		expect(
			requestHost(
				request('http://example.com/a', {
					host: 'example.com',
					'x-forwarded-host': 'evil.test'
				}),
				false
			)
		).toBe('example.com');
	});

	test('takes the first of several hops: the client-facing one', () => {
		expect(
			requestHost(
				request('http://app:3000/a', {
					'x-forwarded-host': 'example.com, cdn.internal'
				}),
				true
			)
		).toBe('example.com');
	});

	test('reads the standard Forwarded header too', () => {
		expect(
			requestHost(
				request('http://app:3000/a', {
					forwarded: 'for=203.0.113.9;host="example.com";proto=https'
				}),
				true
			)
		).toBe('example.com');
	});

	test('keeps a port the browser sent', () => {
		expect(
			requestHost(
				request('http://app:3000/a', {
					'x-forwarded-host': 'example.com:8443'
				}),
				true
			)
		).toBe('example.com:8443');
	});

	/* Even from a trusted proxy: this value becomes part of a URL. */
	test.each([
		'example.com/evil',
		'user@example.com',
		'https://example.com',
		'example.com evil.test',
		'example.com?x=1'
	])('a forwarded value that is not a host is ignored: %s', (value) => {
		expect(
			requestHost(
				request('http://app:3000/a', {
					host: 'app:3000',
					'x-forwarded-host': value
				}),
				true
			)
		).toBe('app:3000');
	});
});

describe('requestOrigin', () => {
	test('is the URL origin on a direct request', () => {
		expect(
			requestOrigin(
				request('https://example.com/a', { host: 'example.com' }),
				false
			)
		).toBe('https://example.com');
	});

	/* The common deployment: a platform terminates TLS and passes Host
	 * through. No setting is needed for this one. */
	test('is https behind a TLS-terminating proxy, with no trust setting', () => {
		expect(
			requestOrigin(
				request('http://example.com/a', {
					host: 'example.com',
					'x-forwarded-proto': 'https'
				}),
				false
			)
		).toBe('https://example.com');
	});

	test('behind a trusted proxy that rewrites Host, is the public origin', () => {
		expect(
			requestOrigin(
				request('http://app:3000/a', {
					host: 'app:3000',
					'x-forwarded-host': 'example.com',
					'x-forwarded-proto': 'https'
				}),
				true
			)
		).toBe('https://example.com');
	});
});

describe('isProxyTrusted', () => {
	test('is off unless the environment says so', () => {
		expect(isProxyTrusted({})).toBe(false);
		expect(isProxyTrusted({ ABSOLUTE_TRUST_PROXY: '0' })).toBe(false);
		expect(isProxyTrusted({ ABSOLUTE_TRUST_PROXY: 'false' })).toBe(false);
	});

	test('is on for 1 or true', () => {
		expect(isProxyTrusted({ ABSOLUTE_TRUST_PROXY: '1' })).toBe(true);
		expect(isProxyTrusted({ ABSOLUTE_TRUST_PROXY: 'true' })).toBe(true);
	});
});
