import { describe, expect, test } from 'bun:test';
import { requestRenderUrl } from '../../../src/utils/requestRenderUrl';

/* The URL a page handler gives the framework's router. `GET //` reached
 * Angular's platform-server as the protocol-relative URL `//`, which it
 * cannot parse (NG05701, a 500 in production). */
describe('requestRenderUrl', () => {
	test('collapses repeated slashes so the path is never protocol-relative', () => {
		expect(requestRenderUrl(new Request('http://localhost//'))).toBe('/');
		expect(requestRenderUrl(new Request('http://localhost///'))).toBe('/');
		expect(
			requestRenderUrl(new Request('http://localhost//portal//b?x=1'))
		).toBe('/portal/b?x=1');
	});

	test('keeps ordinary paths and their query unchanged', () => {
		expect(requestRenderUrl(new Request('http://localhost/'))).toBe('/');
		expect(
			requestRenderUrl(new Request('http://localhost/a/b?q=1&r=//x'))
		).toBe('/a/b?q=1&r=//x');
	});

	test('the result parses against an origin as a path on that origin', () => {
		const url = requestRenderUrl(new Request('http://localhost//')) ?? '';

		expect(new URL(url, 'http://localhost').href).toBe('http://localhost/');
	});

	test('no request gives undefined', () => {
		expect(requestRenderUrl(undefined)).toBeUndefined();
	});
});
