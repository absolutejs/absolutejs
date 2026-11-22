import { describe, expect, test } from 'bun:test';
import { isHttpsRequest } from '../../../src/utils/isHttpsRequest';

/* Whether the BROWSER reached us over TLS, which is not the same as
 * whether this process is serving it. A proxy that terminates TLS
 * forwards plain HTTP, so `request.url` says `http:` on most real
 * deployments.
 *
 * `secureHeaders()` already knew that and read `x-forwarded-proto`. The
 * cookie code did not, so the two disagreed exactly where it matters:
 *
 *   shape                   cookie code   secureHeaders
 *   TLS-terminating proxy   false         TRUE
 *   CDN then load balancer  false         TRUE
 *
 * Behind a proxy the CSRF token cookie and the form-action flash cookie
 * were issued without `Secure`, so a browser would send them over plain
 * HTTP to the same host, where anyone on the network can read them — and
 * a readable CSRF token defeats the token half of the check it exists
 * for. */

const at = (url: string, headers?: Record<string, string>) =>
	new Request(url, headers ? { headers } : undefined);

describe('isHttpsRequest', () => {
	test('a direct TLS request', () => {
		expect(isHttpsRequest(at('https://app.example.com/'))).toBe(true);
	});

	test('a direct plain request', () => {
		expect(isHttpsRequest(at('http://app.example.com/'))).toBe(false);
	});

	/* The case that was wrong: the deployment shape of essentially every
	 * managed platform. */
	test('behind a TLS-terminating proxy', () => {
		expect(
			isHttpsRequest(
				at('http://10.0.0.7:3000/', { 'x-forwarded-proto': 'https' })
			)
		).toBe(true);
	});

	/* The first value is the client's own hop; later ones are the proxies
	 * in between, so a CDN in front of a load balancer sends
	 * `https, http` and the client was still on TLS. Reading the last
	 * value, or the whole string, gets this backwards. */
	test('reads the client hop, not the last one', () => {
		expect(
			isHttpsRequest(
				at('http://10.0.0.7:3000/', {
					'x-forwarded-proto': 'https, http'
				})
			)
		).toBe(true);
	});

	test('a proxy forwarding plain http is not TLS', () => {
		expect(
			isHttpsRequest(
				at('http://10.0.0.7:3000/', { 'x-forwarded-proto': 'http' })
			)
		).toBe(false);
	});

	test('tolerates padding and casing', () => {
		expect(
			isHttpsRequest(
				at('http://10.0.0.7:3000/', { 'x-forwarded-proto': '  HTTPS ' })
			)
		).toBe(true);
	});

	/* RFC 7239's standardised header, which some proxies send instead of
	 * the `x-forwarded-*` family. */
	test('understands the Forwarded header', () => {
		expect(
			isHttpsRequest(
				at('http://10.0.0.7:3000/', {
					forwarded: 'for=203.0.113.4;proto=https'
				})
			)
		).toBe(true);
	});

	test('understands a quoted proto in Forwarded', () => {
		expect(
			isHttpsRequest(
				at('http://10.0.0.7:3000/', { forwarded: 'proto="https"' })
			)
		).toBe(true);
	});

	test('does not match proto=http in Forwarded', () => {
		expect(
			isHttpsRequest(
				at('http://10.0.0.7:3000/', {
					forwarded: 'for=203.0.113.4;proto=http'
				})
			)
		).toBe(false);
	});

	/* A substring match would read `proto=https-something` or a `host`
	 * value that merely contains the text as TLS. */
	test('does not match a lookalike value', () => {
		expect(
			isHttpsRequest(
				at('http://10.0.0.7:3000/', { forwarded: 'host=httpsy.test' })
			)
		).toBe(false);
	});

	test('no forwarding headers at all', () => {
		expect(isHttpsRequest(at('http://app.example.com/'))).toBe(false);
	});

	/* Spoofing can only ever turn `Secure` ON, because the real protocol
	 * is OR-ed in — a client that lies marks its own cookies `Secure`,
	 * which leaks nothing. That is why this needs no trust boundary to be
	 * safe, and this test records the direction. */
	test('a real TLS connection wins regardless of a forwarded header', () => {
		expect(
			isHttpsRequest(
				at('https://app.example.com/', {
					'x-forwarded-proto': 'http'
				})
			)
		).toBe(true);
	});
});
