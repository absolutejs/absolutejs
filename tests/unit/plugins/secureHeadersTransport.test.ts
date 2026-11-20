import { describe, expect, test } from 'bun:test';
import { securityHeadersFor } from '../../../src/plugins/secureHeaders';

/* The headers `secureHeaders()` gained: COOP, CORP and HSTS.
 *
 * HSTS is sticky — once a browser has it, that host is HTTPS-only until
 * the max-age expires, and `includeSubDomains` or `preload` cannot be
 * walked back by changing the header. So it is off unless asked for,
 * conservative when asked for, and never sent over a connection that was
 * not HTTPS. */

const headersFor = (
	url: string,
	options: Parameters<typeof securityHeadersFor>[1] = {},
	requestHeaders: Record<string, string> = {}
) => securityHeadersFor(new Request(url, { headers: requestHeaders }), options);

describe('cross-origin isolation', () => {
	test('COOP allows popups by default', () => {
		// `same-origin` severs window.opener, which breaks an OAuth popup
		// mid-flow — and this framework ships auth with many providers.
		expect(
			headersFor('https://app.test/')['cross-origin-opener-policy']
		).toBe('same-origin-allow-popups');
	});

	test('CORP is same-site by default', () => {
		// An app serving its own assets from a CDN subdomain is the common
		// case, and `same-origin` blocks it.
		expect(
			headersFor('https://app.test/')['cross-origin-resource-policy']
		).toBe('same-site');
	});

	test('both can be tightened or omitted', () => {
		const tightened = headersFor('https://app.test/', {
			crossOriginOpenerPolicy: 'same-origin',
			crossOriginResourcePolicy: 'same-origin'
		});

		expect(tightened['cross-origin-opener-policy']).toBe('same-origin');
		expect(tightened['cross-origin-resource-policy']).toBe('same-origin');

		const omitted = headersFor('https://app.test/', {
			crossOriginOpenerPolicy: false,
			crossOriginResourcePolicy: false
		});

		expect('cross-origin-opener-policy' in omitted).toBe(false);
		expect('cross-origin-resource-policy' in omitted).toBe(false);
	});
});

describe('HSTS', () => {
	test('is off unless asked for', () => {
		expect(
			'strict-transport-security' in headersFor('https://app.test/')
		).toBe(false);
	});

	test('is conservative when asked for', () => {
		// 180 days, and neither flag: both are the parts that cannot be
		// undone by changing the header.
		expect(
			headersFor('https://app.test/', { hsts: true })[
				'strict-transport-security'
			]
		).toBe('max-age=15552000');
	});

	test('takes an explicit max-age and flags', () => {
		expect(
			headersFor('https://app.test/', {
				hsts: {
					includeSubDomains: true,
					maxAge: 31_536_000,
					preload: true
				}
			})['strict-transport-security']
		).toBe('max-age=31536000; includeSubDomains; preload');
	});

	test('is not sent over plain HTTP', () => {
		// A browser ignores it there, and sending it claims a guarantee
		// this connection did not keep.
		expect(
			'strict-transport-security' in
				headersFor('http://app.test/', { hsts: true })
		).toBe(false);
	});

	test('is sent behind a TLS-terminating proxy', () => {
		// The common deployment: the proxy forwards plain HTTP, so the
		// request's own URL says http. The first value is the client's.
		expect(
			headersFor(
				'http://app.test/',
				{ hsts: true },
				{
					'x-forwarded-proto': 'https, http'
				}
			)['strict-transport-security']
		).toBe('max-age=15552000');
	});

	test('a proxy reporting plain HTTP does not get it', () => {
		expect(
			'strict-transport-security' in
				headersFor(
					'http://app.test/',
					{ hsts: true },
					{
						'x-forwarded-proto': 'http'
					}
				)
		).toBe(false);
	});
});

describe('what was already there is unchanged', () => {
	test('nosniff, referrer policy and a CSP still ship', () => {
		const headers = headersFor('https://app.test/');

		expect(headers['x-content-type-options']).toBe('nosniff');
		expect(headers['referrer-policy']).toBe(
			'strict-origin-when-cross-origin'
		);
		expect('content-security-policy' in headers).toBe(true);
	});
});
