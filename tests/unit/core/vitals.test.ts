import { afterEach, describe, expect, test } from 'bun:test';
import {
	injectVitalsReporterHtml,
	isVitalsEnabled,
	resolveVitalsConfig
} from '../../../src/build/vitals';
import {
	createVitalsPlugin,
	onVital,
	type VitalReport
} from '../../../src/core/vitals';

const removers: (() => void)[] = [];
afterEach(() => {
	for (const remove of removers.splice(0)) remove();
});

const post = (body: unknown) =>
	createVitalsPlugin('/__absolute/vitals').handle(
		new Request('http://site.test/__absolute/vitals', {
			body: JSON.stringify(body),
			headers: { 'content-type': 'application/json' },
			method: 'POST'
		})
	);

describe('web vitals endpoint', () => {
	test('passes each metric to onVital with the route, and answers 204', async () => {
		const received: VitalReport[] = [];
		removers.push(onVital((report) => void received.push(report)));
		const response = await post({
			metrics: [
				{ id: 'v5-1', name: 'LCP', rating: 'good', value: 1200 },
				{ delta: 0.01, id: 'v5-2', name: 'CLS', value: 0.01 }
			],
			navigationType: 'navigate',
			route: '/pricing'
		});

		expect(response.status).toBe(204);
		expect(received).toEqual([
			{
				id: 'v5-1',
				name: 'LCP',
				rating: 'good',
				route: '/pricing',
				value: 1200
			},
			{
				delta: 0.01,
				id: 'v5-2',
				name: 'CLS',
				route: '/pricing',
				value: 0.01
			}
		]);
	});

	test('rejects a batch that does not match the schema', async () => {
		const received: VitalReport[] = [];
		removers.push(onVital((report) => void received.push(report)));
		const response = await post({
			metrics: [{ id: 'x', name: 'NOT_A_METRIC', value: 1 }],
			route: '/'
		});

		expect(response.status).toBeGreaterThanOrEqual(400);
		expect(received).toEqual([]);
	});

	test('a failing handler does not fail the request or the other handlers', async () => {
		const received: string[] = [];
		removers.push(
			onVital(() => {
				throw new Error('store down');
			}),
			onVital((report) => void received.push(report.name))
		);
		const originalError = console.error;
		console.error = () => undefined;
		const response = await post({
			metrics: [{ id: 'v5-3', name: 'TTFB', value: 80 }],
			route: '/'
		});
		console.error = originalError;

		expect(response.status).toBe(204);
		expect(received).toEqual(['TTFB']);
	});
});

describe('vitals config', () => {
	test('is on in production builds, and in dev only when asked', () => {
		expect(isVitalsEnabled(undefined, false)).toBe(false);
		expect(isVitalsEnabled({}, false)).toBe(true);
		expect(isVitalsEnabled({}, true)).toBe(false);
		expect(isVitalsEnabled({ dev: true }, true)).toBe(true);
	});

	test('validates sampleRate and defaults the endpoint', () => {
		expect(resolveVitalsConfig({})).toEqual({
			endpoint: '/__absolute/vitals',
			sampleRate: 1
		});
		expect(() => resolveVitalsConfig({ sampleRate: 2 })).toThrow(
			/sampleRate/
		);
	});

	test('adds the reporter to a static page once', () => {
		const page = '<html><head><title>x</title></head><body></body></html>';
		const once = injectVitalsReporterHtml(page);

		expect(once).toContain(
			'<script type="module" src="/__absolute/vitals/reporter.js" data-absolute-vitals></script></head>'
		);
		expect(injectVitalsReporterHtml(once)).toBe(once);
	});
});
