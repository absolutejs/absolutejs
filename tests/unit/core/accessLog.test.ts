import { describe, expect, test } from 'bun:test';
import {
	accessLogLine,
	type AccessLogRecord
} from '../../../src/core/accessLog';

const AT = '2026-11-23T05:30:00.000Z';

const recordOf = (overrides: Partial<AccessLogRecord> = {}) => {
	const record: AccessLogRecord = {
		durationMs: 1.9372,
		method: 'GET',
		path: '/react',
		requestId: 'abc-123',
		status: 200,
		...overrides
	};

	return record;
};

describe('accessLogLine json', () => {
	test('one parseable object per line', () => {
		const line = accessLogLine(recordOf({ size: 2670 }), 'json', AT);

		expect(line).not.toContain('\n');
		expect(JSON.parse(line)).toEqual({
			at: AT,
			durationMs: 1.9,
			level: 'info',
			method: 'GET',
			msg: 'request',
			path: '/react',
			requestId: 'abc-123',
			size: 2670,
			status: 200
		});
	});

	/* A log pipeline filters on level, so the status has to become one.
	 * 5xx is this process's fault; 4xx is the request's. */
	test('the level follows the status class', () => {
		const levelOf = (status: number) =>
			JSON.parse(accessLogLine(recordOf({ status }), 'json', AT)).level;

		expect(levelOf(200)).toBe('info');
		expect(levelOf(304)).toBe('info');
		expect(levelOf(404)).toBe('warn');
		expect(levelOf(429)).toBe('warn');
		expect(levelOf(500)).toBe('error');
		expect(levelOf(503)).toBe('error');
	});

	/* Absent rather than `null`: a key that is sometimes null is a key
	 * every consumer has to special-case. A streamed response has no
	 * content-length, which is the common case here. */
	test('an unknown size is left out', () => {
		expect(
			Object.hasOwn(
				JSON.parse(accessLogLine(recordOf({ size: null }), 'json', AT)),
				'size'
			)
		).toBe(false);
		expect(
			Object.hasOwn(
				JSON.parse(accessLogLine(recordOf(), 'json', AT)),
				'size'
			)
		).toBe(false);
	});

	/* The id is validated before it gets here, but a path is not — it comes
	 * from the URL, and a request for `/a"b` is legal. One line in, one
	 * line out. */
	test('a hostile path cannot end the record', () => {
		const line = accessLogLine(
			recordOf({ path: '/a"},{"msg":"forged"' }),
			'json',
			AT
		);

		expect(line).not.toContain('\n');
		expect(JSON.parse(line).path).toBe('/a"},{"msg":"forged"');
	});
});

describe('accessLogLine text', () => {
	test('reads as one line a human can scan', () => {
		expect(accessLogLine(recordOf(), 'text', AT)).toBe(
			`${AT} GET /react 200 1.9ms req=abc-123`
		);
	});

	test('rounds the duration the same way', () => {
		expect(
			accessLogLine(recordOf({ durationMs: 603.4891 }), 'text', AT)
		).toContain('603.5ms');
	});
});
