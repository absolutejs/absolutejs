import { afterEach, describe, expect, test } from 'bun:test';
import {
	handleHTMLPageRequest,
	handleHTMXPageRequest
} from '../../../src/core/pageHandlers';

const tempFiles: string[] = [];

const writeTempPage = async (html: string) => {
	const path = `/tmp/absolutejs-page-handler-${crypto.randomUUID()}.html`;
	await Bun.write(path, html);
	tempFiles.push(path);

	return path;
};

afterEach(async () => {
	await Promise.all(
		tempFiles.splice(0).map(async (path) => {
			try {
				await Bun.file(path).delete();
			} catch {
				// Ignore missing temp files.
			}
		})
	);
});

describe('static page handlers', () => {
	test('handleHTMLPageRequest rejects abs-stream-slot markup', async () => {
		const pagePath = await writeTempPage(
			'<!DOCTYPE html><html><head></head><body><abs-stream-slot resolver="salesSummary"><section>Loading summary...</section></abs-stream-slot></body></html>'
		);

		await expect(handleHTMLPageRequest(pagePath)).rejects.toThrow(
			'HTML page'
		);
	});

	test('handleHTMLPageRequest applies explicit streaming slots through handler options', async () => {
		const pagePath = await writeTempPage(
			'<!DOCTYPE html><html><head></head><body><div id="html-report"></div></body></html>'
		);

		const response = await handleHTMLPageRequest(pagePath, {
			streamingSlots: [
				{
					id: 'html-report',
					resolve: async () => '<section>html ready</section>'
				}
			]
		});
		const html = await response.text();

		expect(html).toContain('__ABS_SLOT_ENQUEUE__');
		expect(html).toContain('"html-report"');
		expect(html).toContain('html ready');
	});

	test('handleHTMXPageRequest serves plain HTMX pages without static streaming sidecars', async () => {
		const pagePath = await writeTempPage(
			'<!DOCTYPE html><html><head></head><body><div id="results" hx-get="/htmx/report" hx-trigger="load"></div></body></html>'
		);

		const response = await handleHTMXPageRequest(pagePath);
		const html = await response.text();

		expect(html).toContain('hx-get="/htmx/report"');
		expect(html).not.toContain('__ABS_SLOT_ENQUEUE__');
	});

	test('handleHTMXPageRequest lowers abs-htmx-stream-slot into native htmx markup', async () => {
		const pagePath = await writeTempPage(
			'<!DOCTYPE html><html><head></head><body><abs-htmx-stream-slot src="/htmx/report"><article class="card card-fallback"><h2>Report</h2><p>Loading...</p></article></abs-htmx-stream-slot></body></html>'
		);

		const response = await handleHTMXPageRequest(pagePath);
		const html = await response.text();

		expect(html).toContain('hx-get="/htmx/report"');
		expect(html).toContain('hx-trigger="load"');
		expect(html).toContain('hx-swap="outerHTML"');
		expect(html).toContain('hx-target="this"');
		expect(html).not.toContain('<abs-htmx-stream-slot');
		expect(html).not.toContain('__ABS_SLOT_ENQUEUE__');
	});

	test('handleHTMXPageRequest rejects abs-stream-slot markup', async () => {
		const pagePath = await writeTempPage(
			'<!DOCTYPE html><html><head></head><body><abs-stream-slot resolver="reportCard"><section>Loading...</section></abs-stream-slot></body></html>'
		);

		await expect(handleHTMXPageRequest(pagePath)).rejects.toThrow(
			'HTMX page'
		);
	});
});
