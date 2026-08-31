import { describe, expect, test } from 'bun:test';
import {
	ABSOLUTE_EXPO_BRIDGE_FORMAT,
	ABSOLUTE_EXPO_BRIDGE_MAX_BYTES,
	createAbsoluteExpoBridgeError,
	createAbsoluteExpoBridgeResponse,
	parseAbsoluteExpoBridgeMessage
} from '../../../src/mobile/expoBridge';

describe('Expo bridge protocol', () => {
	test('accepts an allowlisted device request', () => {
		expect(
			parseAbsoluteExpoBridgeMessage(
				JSON.stringify({
					format: ABSOLUTE_EXPO_BRIDGE_FORMAT,
					id: 'request_1',
					kind: 'request',
					method: 'devices.haptics.impact',
					params: { style: 'medium' },
					path: '/scanner'
				})
			)
		).toMatchObject({ method: 'devices.haptics.impact' });
	});

	test('rejects unknown methods, origins disguised as paths, and oversized data', () => {
		const request: Record<string, unknown> = {
			format: ABSOLUTE_EXPO_BRIDGE_FORMAT,
			id: 'request_1',
			kind: 'request',
			method: 'eval',
			params: {},
			path: '//evil.example'
		};
		expect(() =>
			parseAbsoluteExpoBridgeMessage(JSON.stringify(request))
		).toThrow('method is not allowed');
		expect(() =>
			parseAbsoluteExpoBridgeMessage(
				JSON.stringify({ ...request, method: 'devices.haptics.impact' })
			)
		).toThrow('path is invalid');
		expect(() =>
			parseAbsoluteExpoBridgeMessage(
				'a'.repeat(ABSOLUTE_EXPO_BRIDGE_MAX_BYTES + 1)
			)
		).toThrow('64 KiB');
	});

	test('creates mutually exclusive success and error responses', () => {
		expect(createAbsoluteExpoBridgeResponse('request_1', null)).toEqual({
			format: 2,
			id: 'request_1',
			kind: 'response',
			result: null
		});
		expect(
			createAbsoluteExpoBridgeError('request_1', 'failed', 'No haptics')
		).toMatchObject({ error: { code: 'failed' } });
	});

	test('allows only bounded production-style GET transport headers', () => {
		expect(
			parseAbsoluteExpoBridgeMessage(
				JSON.stringify({
					format: 2,
					id: 'http_1',
					kind: 'request',
					method: 'http.fetch',
					params: {
						headers: {
							accept: 'application/vnd.absolute.page+json',
							'x-absolute-mobile-protocol': '1'
						},
						method: 'GET',
						url: 'https://api.example.com/account'
					},
					path: '/account'
				})
			)
		).toMatchObject({ method: 'http.fetch' });
		expect(() =>
			parseAbsoluteExpoBridgeMessage(
				JSON.stringify({
					format: 2,
					id: 'http_2',
					kind: 'request',
					method: 'http.fetch',
					params: {
						headers: { authorization: 'Bearer secret' },
						method: 'GET',
						url: 'https://api.example.com/account'
					},
					path: '/account'
				})
			)
		).toThrow('header is not allowed');
	});

	test('allows bounded authenticated HTTP and typed Auth operations', () => {
		expect(
			parseAbsoluteExpoBridgeMessage(
				JSON.stringify({
					format: 2,
					id: 'http_post',
					kind: 'request',
					method: 'http.fetch',
					params: {
						body: '{"name":"Ada"}',
						headers: { 'content-type': 'application/json' },
						method: 'POST',
						url: 'https://api.example.com/account'
					},
					path: '/account'
				})
			)
		).toMatchObject({ method: 'http.fetch' });
		expect(
			parseAbsoluteExpoBridgeMessage(
				JSON.stringify({
					format: 2,
					id: 'auth_sign_in',
					kind: 'request',
					method: 'auth.signIn',
					params: { email: 'ada@example.com', signup: false },
					path: '/account'
				})
			)
		).toMatchObject({ method: 'auth.signIn' });
		expect(() =>
			parseAbsoluteExpoBridgeMessage(
				JSON.stringify({
					format: 2,
					id: 'auth_bad',
					kind: 'request',
					method: 'auth.signIn',
					params: { password: 'must-not-cross' },
					path: '/account'
				})
			)
		).toThrow('sign-in params are invalid');
	});
});
