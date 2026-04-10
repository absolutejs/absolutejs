import { describe, expect, test } from 'bun:test';
import {
	transformCurrentStaticPageHtml,
	transformStaticHTMXStreamSlotHtml,
	transformStaticStreamingSlotHtml
} from '../../../src/build/staticIslandPages';

describe('transformCurrentStaticPageHtml', () => {
	test('returns plain static html without requiring an island registry', async () => {
		const html =
			'<!doctype html><html><head><title>Static</title></head><body><main><h1>Hello</h1></main></body></html>';

		await expect(transformCurrentStaticPageHtml(html)).resolves.toBe(html);
	});

	test('lowers abs-stream-slot tags into streaming placeholders', () => {
		const html =
			'<!doctype html><html><body><abs-stream-slot id="sales" resolver="salesSummary"><section>Loading summary...</section></abs-stream-slot></body></html>';

		const transformed = transformStaticStreamingSlotHtml(html);

		expect(transformed).toContain('id="sales"');
		expect(transformed).toContain('data-absolute-slot="true"');
		expect(transformed).toContain('<section>Loading summary...</section>');
		expect(transformed).not.toContain('<abs-stream-slot');
	});

	test('lowers abs-htmx-stream-slot tags into native htmx markup', () => {
		const html =
			'<!doctype html><html><body><abs-htmx-stream-slot src="/htmx/cards/summary"><article class="card card-fallback"><h2>Summary</h2><p>Loading...</p></article></abs-htmx-stream-slot></body></html>';

		const transformed = transformStaticHTMXStreamSlotHtml(html);

		expect(transformed).toContain('hx-get="/htmx/cards/summary"');
		expect(transformed).toContain('hx-trigger="load"');
		expect(transformed).toContain('hx-swap="outerHTML"');
		expect(transformed).toContain('hx-target="this"');
		expect(transformed).toContain('<article class="card card-fallback"');
		expect(transformed).not.toContain('<abs-htmx-stream-slot');
	});
});
