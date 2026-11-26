import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import type { Page } from 'playwright';
import { openPage } from '../../../helpers/browser';
import { startDevServer, type DevServer } from '../../../helpers/devServer';
import {
	mutateFile,
	restoreAllFiles,
	restoreFile
} from '../../../helpers/file';

/* Hot reloading a page with `ssr: false`.
 *
 * A client-only page has no server markup, so two things an edit relies
 * on elsewhere are absent: there is nothing for a hot update to patch
 * against except what the browser rendered, and a full reload cannot
 * fall back on the server's copy of the page. Each framework's page in
 * the example app is switched to `ssr: false` before the server starts,
 * then edited while open in a browser.
 *
 * Asserted per framework: the edit shows in the open page (whether the
 * framework patched it in place or reloaded is its own business, and not
 * asserted), nothing was logged as an error, and a fresh load afterwards still
 * gets a shell (the server did not start rendering it) that renders the
 * edited page. */

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..', '..');
const SERVER_ENTRY = resolve(PROJECT_ROOT, 'example/server.ts');
const FLAG = 'window.__ABSOLUTE_PAGE_RENDER_MODE__="client"';

const HANDLER_CALLS = [
	'\t\treturn handleReactPageRequest({\n\t\t\tindex,',
	'\t\thandleSveltePageRequest<typeof SvelteExample>({\n',
	'\t\thandleVuePageRequest<typeof VueExample>({\n',
	'\t\thandleAngularPageRequest<AngularExamplePage.Context>({\n'
];

type Case = {
	file: string;
	framework: string;
	heading: string;
	path: string;
};

const CASES: Case[] = [
	{
		file: 'example/react/components/App.tsx',
		framework: 'React',
		heading: '<h1>AbsoluteJS + React</h1>',
		path: '/react'
	},
	{
		file: 'example/svelte/pages/SvelteExample.svelte',
		framework: 'Svelte',
		heading: '<h1>AbsoluteJS + Svelte</h1>',
		path: '/svelte'
	},
	{
		file: 'example/vue/pages/VueExample.vue',
		framework: 'Vue',
		heading: '<h1>AbsoluteJS + Vue</h1>',
		path: '/vue'
	},
	{
		file: 'example/angular/templates/app.component.html',
		framework: 'Angular',
		heading: '<h1>AbsoluteJS + Angular</h1>',
		path: '/angular'
	}
];

let server: DevServer | undefined;

beforeAll(async () => {
	mutateFile(SERVER_ENTRY, (source) =>
		HANDLER_CALLS.reduce((edited, call) => {
			if (!edited.includes(call))
				throw new Error(
					`example/server.ts no longer contains ${JSON.stringify(call)}`
				);

			return edited.replace(call, `${call}\t\t\tssr: false,\n`);
		}, source)
	);
	server = await startDevServer();
}, 120_000);

afterAll(async () => {
	await server?.kill();
	restoreAllFiles();
});

const urlOf = (path: string) => {
	if (!server) throw new Error('the dev server is not running');

	return `${server.baseUrl}${path}`;
};

type PageLog = { entries: string[] };

const record = (log: PageLog) => (page: Page) => {
	page.on('pageerror', (error) => {
		log.entries.push(`pageerror: ${error.message}`);
	});
	page.on('console', (message) => {
		if (message.type() === 'error')
			log.entries.push(`console.error: ${message.text()}`);
	});
};

const headingText = (page: Page) =>
	page.evaluate(() => document.querySelector('h1')?.textContent?.trim());

describe.each(CASES)(
	'editing the $framework page while it is open, with ssr: false',
	({ file, framework, heading, path }) => {
		const edited = `CLIENT_ONLY_EDIT_${framework.toUpperCase()}`;
		const source = resolve(PROJECT_ROOT, file);

		test('shows the edit, and a fresh load renders it too', async () => {
			const log: PageLog = { entries: [] };
			const session = await openPage(urlOf(path), {
				onPage: record(log),
				waitUntil: 'load'
			});
			try {
				const { page } = session;
				await page.waitForFunction(
					(expected) =>
						document.querySelector('h1')?.textContent?.trim() ===
						expected,
					`AbsoluteJS + ${framework}`,
					{ timeout: 60_000 }
				);

				mutateFile(source, (contents) =>
					contents.replace(heading, `<h1>${edited}</h1>`)
				);
				await page.waitForFunction(
					(expected) =>
						document.querySelector('h1')?.textContent?.trim() ===
						expected,
					edited,
					{ timeout: 60_000 }
				);
				expect(log.entries).toEqual([]);

				// The server still sends a shell for it, edit or not.
				const shell = await (await fetch(urlOf(path))).text();
				expect(shell).toContain(FLAG);
				expect(shell).not.toContain(edited);

				// And a visitor arriving now gets the edited page.
				await page.reload({ waitUntil: 'load' });
				await page.waitForFunction(
					(expected) =>
						document.querySelector('h1')?.textContent?.trim() ===
						expected,
					edited,
					{ timeout: 60_000 }
				);
				expect(await headingText(page)).toBe(edited);
				expect(log.entries).toEqual([]);
			} finally {
				await session.close();
				restoreFile(source);
			}
		}, 240_000);
	}
);
