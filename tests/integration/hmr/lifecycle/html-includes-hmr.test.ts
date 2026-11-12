import { afterEach, describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { startDevServer, type DevServer } from '../../../helpers/devServer';
import { connectHMR, type HMRClient } from '../../../helpers/ws';
import { createFile, mutateFile, restoreAllFiles } from '../../../helpers/file';

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..', '..');

let server: DevServer | undefined;
let client: HMRClient | undefined;

afterEach(async () => {
	client?.close();
	client = undefined;
	if (server) {
		await server.kill();
		server = undefined;
	}
	restoreAllFiles();
});

const partial = resolve(
	PROJECT_ROOT,
	'example/html/partials/IncludeBanner.html'
);
const examplePage = resolve(
	PROJECT_ROOT,
	'example/html/pages/HTMLExample.html'
);
const secondPage = resolve(PROJECT_ROOT, 'example/html/pages/IncludeTwo.html');

type HtmlUpdate = { data?: { html?: unknown; sourceFile?: string } };

/* A partial isn't a page: editing it must live-update every page that
 * includes it. */
describe('HTML include HMR', () => {
	test('editing a partial updates both pages that include it', async () => {
		createFile(partial, '<p data-test-id="banner">BANNER_V1</p>\n');
		createFile(
			secondPage,
			'<!doctype html><html><head><title>Two</title></head><body><abs-include src="../partials/IncludeBanner.html"></abs-include></body></html>\n'
		);
		mutateFile(examplePage, (source) =>
			source.replace(
				'<h1>AbsoluteJS + HTML</h1>',
				'<h1>AbsoluteJS + HTML</h1>\n\t\t\t<abs-include src="../partials/IncludeBanner.html"></abs-include>'
			)
		);
		server = await startDevServer();
		client = await connectHMR(server.port);
		await client.waitFor('manifest');
		await client.waitFor('connected');
		expect(await (await fetch(`${server.baseUrl}/html`)).text()).toContain(
			'BANNER_V1'
		);
		client.drain();

		mutateFile(partial, (source) =>
			source.replace('BANNER_V1', 'BANNER_V2')
		);
		await client.waitFor('html-update', 30_000);
		// waitFor hands back an already-delivered message again, so read
		// the full list until both pages have reported.
		const pageName = (update: HtmlUpdate) => {
			const file = update.data?.sourceFile ?? '';

			return file.slice(file.lastIndexOf('/') + 1);
		};
		const htmlUpdates = () =>
			client?.messages.filter(
				(message): message is HtmlUpdate & { type: string } =>
					message.type === 'html-update'
			) ?? [];
		const deadline = Date.now() + 30_000;
		while (
			new Set(htmlUpdates().map(pageName)).size < 2 &&
			Date.now() < deadline
		) {
			await Bun.sleep(100);
		}
		const updates = htmlUpdates();
		const pages = [...new Set(updates.map(pageName))].sort();
		expect(pages).toEqual(['HTMLExample.html', 'IncludeTwo.html']);
		for (const update of updates) {
			expect(JSON.stringify(update.data?.html)).toContain('BANNER_V2');
		}
		expect(await (await fetch(`${server.baseUrl}/html`)).text()).toContain(
			'BANNER_V2'
		);
	}, 90_000);
});
