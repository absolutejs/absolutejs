import { afterEach, describe, expect, test } from 'bun:test';
import {
	injectVitalsReporterHtml,
	isVitalsEnabled,
	resolveVitalsConfig,
	resolveVitalsSummary
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

const SUMMARY_PATH = '/__absolute/vitals/summary';

const plugin = (summary?: { maxRoutes?: number; path: string }) =>
	createVitalsPlugin({ path: '/__absolute/vitals', summary });

const postTo = (app: ReturnType<typeof plugin>, body: unknown) =>
	app.handle(
		new Request('http://site.test/__absolute/vitals', {
			body: JSON.stringify(body),
			headers: { 'content-type': 'application/json' },
			method: 'POST'
		})
	);

const post = (body: unknown) => postTo(plugin(), body);

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

describe('the summary endpoint', () => {
	const summaryOf = async (app: ReturnType<typeof plugin>) => {
		const response = await app.handle(
			new Request(`http://site.test${SUMMARY_PATH}`)
		);

		return { body: await response.json(), response };
	};

	/* The defect this item exists for. Collection shipped, nothing
	 * registered an `onVital` handler anywhere in the framework or the
	 * example app, so a batch was validated, rate-limited and discarded:
	 * the reporter in every client bundle measured a page load and the
	 * measurement did not survive the request. */
	test('reports what was posted, per route and metric', async () => {
		const app = plugin({ path: SUMMARY_PATH });
		await postTo(app, {
			metrics: [
				{ id: 'a1', name: 'LCP', value: 1200 },
				{ id: 'a2', name: 'CLS', value: 0.04 }
			],
			route: '/pricing'
		});
		await postTo(app, {
			metrics: [{ id: 'a3', name: 'LCP', value: 9000 }],
			route: '/dashboard'
		});
		const { body, response } = await summaryOf(app);

		expect(response.status).toBe(200);
		expect(body.sampleCount).toBe(3);
		expect(
			body.routes.map((entry: { route: string }) => entry.route)
		).toEqual(['/pricing', '/dashboard']);
		expect(body.routes[0].metrics.LCP.rating).toBe('good');
		expect(body.routes[0].metrics.CLS.count).toBe(1);
		expect(body.routes[1].metrics.LCP.rating).toBe('poor');
	});

	/* The numbers change with every page load, and a proxy with a default
	 * policy will cache a GET returning JSON — which would serve a moment
	 * that has passed as the current one. */
	test('is never cached', async () => {
		const { response } = await summaryOf(plugin({ path: SUMMARY_PATH }));

		expect(response.headers.get('cache-control')).toBe('no-store');
	});

	/* Without a summary there is nothing that can read a histogram, so
	 * holding one would be memory spent on data with no reader. */
	test('is not served, and nothing is aggregated, when it is off', async () => {
		const app = plugin();
		await postTo(app, {
			metrics: [{ id: 'b1', name: 'LCP', value: 1200 }],
			route: '/'
		});
		const response = await app.handle(
			new Request(`http://site.test${SUMMARY_PATH}`)
		);

		expect(response.status).toBe(404);
	});

	/* An empty store has to be distinguishable from a fast site. */
	test('an empty summary says so rather than looking like good numbers', async () => {
		const { body } = await summaryOf(plugin({ path: SUMMARY_PATH }));

		expect(body).toMatchObject({
			routes: [],
			sampleCount: 0,
			truncated: false
		});
	});

	test('aggregating does not stop onVital handlers from running', async () => {
		const received: VitalReport[] = [];
		removers.push(onVital((report) => void received.push(report)));
		const app = plugin({ path: SUMMARY_PATH });
		await postTo(app, {
			metrics: [{ id: 'c1', name: 'TTFB', value: 90 }],
			route: '/'
		});
		const { body } = await summaryOf(app);

		expect(received.map((report) => report.name)).toEqual(['TTFB']);
		expect(body.sampleCount).toBe(1);
	});
});

describe('vitals config', () => {
	/* The one mode-dependent default in this feature. In dev you turned
	 * collection on to look at the numbers. In production the endpoint is
	 * an unauthenticated read of every route that reported and how slow it
	 * is, which is a choice to publish rather than a default to inherit. */
	test('the summary is on in dev and off in production unless asked for', () => {
		expect(resolveVitalsSummary({}, true)).toEqual({
			maxRoutes: undefined,
			path: '/__absolute/vitals/summary'
		});
		expect(resolveVitalsSummary({}, false)).toBeUndefined();
		expect(resolveVitalsSummary({ summary: true }, false)?.path).toBe(
			'/__absolute/vitals/summary'
		);
		expect(resolveVitalsSummary({ summary: false }, true)).toBeUndefined();
	});

	test('a configured path and cap are kept', () => {
		expect(
			resolveVitalsSummary(
				{ summary: { maxRoutes: 10, path: '/internal/vitals' } },
				false
			)
		).toEqual({ maxRoutes: 10, path: '/internal/vitals' });
	});

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
