import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	test
} from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

// Preserve Bun's native fetch before happy-dom overwrites it; the overlay's
// summary poll is stubbed per test, and the natives are what other suites
// in this process expect to find afterwards.
const nativeFetch = globalThis.fetch;
const nativeRequest = globalThis.Request;
const nativeResponse = globalThis.Response;
const nativeHeaders = globalThis.Headers;

GlobalRegistrator.register();

globalThis.fetch = nativeFetch;
globalThis.Request = nativeRequest;
globalThis.Response = nativeResponse;
globalThis.Headers = nativeHeaders;

afterAll(() => GlobalRegistrator.unregister());

import { VITAL_THRESHOLDS } from '../../../src/core/vitalsStore';
import { mountVitalsOverlay } from '../../../src/dev/client/vitalsOverlay';
import type { VitalsSummary } from '../../../types/vitals';

/* The overlay as it actually renders. A badge nobody can read is as much a
 * defect as a wrong number, and the thing it is for is being glanceable
 * while metrics arrive one at a time. */

const CONTAINER = '#__abs_vitals_overlay__';

const mount = (
	options: Partial<Parameters<typeof mountVitalsOverlay>[0]> = {}
) =>
	mountVitalsOverlay({
		route: '/pricing',
		sampled: true,
		thresholds: VITAL_THRESHOLDS,
		...options
	});

const overlayText = () =>
	document.querySelector(CONTAINER)?.textContent ?? '(not mounted)';

beforeEach(() => {
	document.body.innerHTML = '';
	localStorage.clear();
	sessionStorage.clear();
});

afterEach(() => {
	globalThis.fetch = nativeFetch;
});

describe('the badge', () => {
	/* Before anything has been measured there must be something on screen,
	 * or the first impression of the overlay is that it is broken. */
	test('says it is waiting before the first metric arrives', () => {
		mount();

		expect(overlayText()).toContain('waiting for metrics');
	});

	/* Metrics land at different times — TTFB at once, LCP when the paint
	 * settles, INP only on interaction — so the badge has to fill in
	 * rather than appear complete. */
	test('fills in as metrics arrive, in load order', () => {
		const overlay = mount();
		overlay.report({ name: 'LCP', value: 1200 });
		overlay.report({ name: 'TTFB', value: 84 });

		/* TTFB before LCP regardless of which was reported first. */
		expect(overlayText()).toMatch(/TTFB.*84ms.*LCP.*1\.20s/u);
	});

	test('formats each metric on its own scale', () => {
		const overlay = mount();
		overlay.report({ name: 'TTFB', value: 84 });
		overlay.report({ name: 'LCP', value: 2450 });
		overlay.report({ name: 'CLS', value: 0.042 });
		const text = overlayText();

		expect(text).toContain('84ms');
		expect(text).toContain('2.45s');
		/* Unitless, and not rounded to zero. */
		expect(text).toContain('0.042');
	});

	/* The colour is the whole point of a glanceable badge, and it has to
	 * agree with how the summary endpoint bands the same value. */
	test('colours a value by the band the summary would put it in', () => {
		const overlay = mount();
		overlay.report({ name: 'LCP', value: 1200 });
		overlay.report({ name: 'INP', value: 1200 });
		const colors = [...document.querySelectorAll(`${CONTAINER} span`)].map(
			(span) => (span as HTMLElement).style.color
		);

		/* LCP 1200 is good, INP 1200 is poor — the same number, banded
		 * differently, which a shared threshold table is what gets right. */
		expect(colors).toContain('#4ade80');
		expect(colors).toContain('#f87171');
	});

	/* `sampleRate` governs sending, not display. Without this line a
	 * developer on sampleRate 0.1 cannot tell a fast page from a quiet
	 * reporter. */
	test('says when a load will not be reported', () => {
		const overlay = mount({ sampled: false });
		overlay.report({ name: 'LCP', value: 1200 });

		expect(overlayText()).toContain('not sampled');
	});

	test('does not mount twice on the same page', () => {
		mount();
		mount();

		expect(document.querySelectorAll(CONTAINER).length).toBe(1);
	});
});

describe('expanding it', () => {
	const summary: VitalsSummary = {
		routes: [
			{
				metrics: {
					LCP: {
						count: 418,
						good: 361,
						needsImprovement: 44,
						p75: 2180,
						poor: 13,
						rating: 'good'
					}
				},
				route: '/pricing'
			}
		],
		sampleCount: 1044,
		since: '2026-11-23T09:12:40.118Z',
		truncated: false
	};

	const stubSummary = (body: VitalsSummary) => {
		const calls: string[] = [];
		globalThis.fetch = ((input: string) => {
			calls.push(String(input));

			return Promise.resolve({
				ok: true,
				json: () => Promise.resolve(body)
			});
		}) as unknown as typeof fetch;

		return calls;
	};

	const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

	test('shows this load beside the p75 for the same route', async () => {
		const calls = stubSummary(summary);
		const overlay = mount({ summaryPath: '/__absolute/vitals/summary' });
		overlay.report({ name: 'LCP', value: 3100 });
		document.querySelector<HTMLElement>(`${CONTAINER} > div`)?.click();
		await settle();
		const text = overlayText();

		expect(calls).toEqual(['/__absolute/vitals/summary']);
		expect(text).toContain('this load');
		/* This load was slow; the route's p75 is not. Seeing both is the
		 * reason to read the aggregate at all. */
		expect(text).toContain('3.10s');
		expect(text).toContain('2.18s (418)');
		expect(text).toContain('1044 samples');
	});

	/* The thresholds are shown rather than implied, so a colour can be
	 * checked against the number that produced it. */
	test('names the threshold each band comes from', async () => {
		stubSummary(summary);
		mount({ summaryPath: '/s' });
		document.querySelector<HTMLElement>(`${CONTAINER} > div`)?.click();
		await settle();

		expect(overlayText()).toContain('good ≤ 2.50s, poor > 4.00s');
		/* CLS is published as 0.1 and 0.25; printed to three places it
		 * would read as a precision the standard does not claim. */
		expect(overlayText()).toContain('good ≤ 0.1, poor > 0.25');
	});

	/* Collapsed it must cost nothing: a dev tool polling a server that is
	 * rebuilding is noise in the log and load on the thing being measured. */
	test('does not poll while collapsed', async () => {
		const calls = stubSummary(summary);
		mount({ summaryPath: '/s' });
		await settle();

		expect(calls).toEqual([]);
	});

	/* An expanded overlay with no summary endpoint has to explain the empty
	 * column rather than look broken. */
	test('explains the missing p75 column when the summary is off', async () => {
		const overlay = mount();
		overlay.report({ name: 'LCP', value: 1200 });
		document.querySelector<HTMLElement>(`${CONTAINER} > div`)?.click();
		await settle();

		expect(overlayText()).toContain('vitals.summary');
	});

	test('remembers being open across loads', async () => {
		stubSummary(summary);
		mount({ summaryPath: '/s' });
		document.querySelector<HTMLElement>(`${CONTAINER} > div`)?.click();
		await settle();

		document.body.innerHTML = '';
		mount({ summaryPath: '/s' });
		await settle();

		expect(overlayText()).toContain('this load');
	});

	/* A failed poll must leave the badge alone: the dev server restarting
	 * is the normal case, not an error worth showing. */
	test('survives a summary request that fails', async () => {
		globalThis.fetch = (() =>
			Promise.reject(
				new Error('server restarting')
			)) as unknown as typeof fetch;
		const overlay = mount({ summaryPath: '/s' });
		overlay.report({ name: 'LCP', value: 1200 });
		document.querySelector<HTMLElement>(`${CONTAINER} > div`)?.click();
		await settle();

		expect(overlayText()).toContain('1.20s');
	});
});

describe('dismissing it', () => {
	/* sessionStorage, so this is not a decision made once and impossible to
	 * remember how to undo — a new tab brings it back. */
	test('stays hidden for the tab, and comes back in a new one', () => {
		mount();
		document
			.querySelector<HTMLElement>(`${CONTAINER} > div > span:last-child`)
			?.click();

		expect(document.querySelector(CONTAINER)).toBeNull();

		mount();

		expect(document.querySelector(CONTAINER)).toBeNull();

		sessionStorage.clear();
		mount();

		expect(document.querySelector(CONTAINER)).not.toBeNull();
	});
});
