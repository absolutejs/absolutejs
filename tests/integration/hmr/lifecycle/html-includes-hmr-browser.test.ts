import { afterEach, describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import type { Page } from 'playwright';
import { openPage, type BrowserSession } from '../../../helpers/browser';
import { startDevServer, type DevServer } from '../../../helpers/devServer';
import {
	createFile,
	mutateFile,
	mutateFileInPlace,
	restoreAllFiles
} from '../../../helpers/file';

/* Two tabs on two pages that share a partial through a layout with a
 * default and a named (head) slot. Editing the partial must update each tab
 * with its own page: its own body, its own head slot, and the new partial
 * text. Before the fix every tab got every page's update, so both ended on
 * the last page broadcast (Page B), and Layout A lost its <title>. */

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..', '..');
const html = (path: string) => resolve(PROJECT_ROOT, 'example/html', path);

const partial = html('partials/SharedHeader.html');
const layout = html('layouts/SharedLayout.html');
const pageA = html('pages/LayoutA.html');
const pageB = html('pages/LayoutB.html');
const serverEntry = resolve(PROJECT_ROOT, 'example/server.ts');

const pageSource = (name: string) =>
	`<abs-include src="../layouts/SharedLayout.html">
	<template slot="head"><title>Layout ${name} title</title></template>
	<main data-test-id="body">PAGE_${name}_BODY</main>
	<p id="counter">0</p>
</abs-include>
`;

let server: DevServer | undefined;
const sessions: BrowserSession[] = [];

afterEach(async () => {
	await Promise.all(sessions.splice(0).map((session) => session.close()));
	if (server) {
		await server.kill();
		server = undefined;
	}
	restoreAllFiles();
});

const snapshot = (page: Page) =>
	page.evaluate(() => ({
		body: document.querySelector('[data-test-id="body"]')?.textContent,
		header: document.querySelector('[data-test-id="header"]')?.textContent,
		title: document.title
	}));

const waitForHeader = (page: Page, text: string) =>
	page.waitForFunction(
		(expected) =>
			document.querySelector('[data-test-id="header"]')?.textContent ===
			expected,
		text,
		{ timeout: 30_000 }
	);

describe('HTML include HMR in the browser', () => {
	test('editing a shared partial updates each open page with its own content', async () => {
		createFile(
			partial,
			'<header id="site-header" data-test-id="header">HEADER_V1</header>\n'
		);
		createFile(
			layout,
			`<!doctype html>
<html>
	<head>
		<meta charset="utf-8" />
		<abs-slot name="head"><title>Default title</title></abs-slot>
	</head>
	<body>
		<abs-include src="../partials/SharedHeader.html"></abs-include>
		<abs-slot></abs-slot>
	</body>
</html>
`
		);
		createFile(pageA, pageSource('A'));
		createFile(pageB, pageSource('B'));
		mutateFile(serverEntry, (source) =>
			source.replace(
				".get('/html', () => handleHTMLPageRequest(asset(manifest, 'HTMLExample')))",
				".get('/html', () => handleHTMLPageRequest(asset(manifest, 'HTMLExample')))\n\t.get('/layout-a', () => handleHTMLPageRequest(asset(manifest, 'LayoutA')))\n\t.get('/layout-b', () => handleHTMLPageRequest(asset(manifest, 'LayoutB')))"
			)
		);

		server = await startDevServer();
		const sessionA = await openPage(`${server.baseUrl}/layout-a`);
		sessions.push(sessionA);
		const sessionB = await openPage(`${server.baseUrl}/layout-b`);
		sessions.push(sessionB);
		const tabA = sessionA.page;
		const tabB = sessionB.page;
		expect(await snapshot(tabA)).toEqual({
			body: 'PAGE_A_BODY',
			header: 'HEADER_V1',
			title: 'Layout A title'
		});
		expect(await snapshot(tabB)).toEqual({
			body: 'PAGE_B_BODY',
			header: 'HEADER_V1',
			title: 'Layout B title'
		});
		await server.waitForIdle();
		// Live updates patch in place: a marker on window survives them and
		// would be gone after a reload.
		await tabA.evaluate(() => Reflect.set(window, '__noReload', true));
		await tabB.evaluate(() => Reflect.set(window, '__noReload', true));
		// Text a script changed survives updates; edited markup (the
		// header, which also has an id) does not get its old text back.
		await tabA.evaluate(() => {
			const counter = document.getElementById('counter');
			if (counter) counter.textContent = '5';
		});

		const edit = async (text: string, write = mutateFile) => {
			write(partial, (source) => source.replace(/HEADER_V\d+/, text));
			await Promise.all([
				waitForHeader(tabA, text),
				waitForHeader(tabB, text)
			]);
			// Let any late, wrong broadcast land before checking.
			await server?.waitForIdle();
			await Bun.sleep(300);
			expect(await snapshot(tabA)).toEqual({
				body: 'PAGE_A_BODY',
				header: text,
				title: 'Layout A title'
			});
			expect(await snapshot(tabB)).toEqual({
				body: 'PAGE_B_BODY',
				header: text,
				title: 'Layout B title'
			});
		};

		await edit('HEADER_V2');
		// A second edit, saved in place the way many editors do, must show
		// its own text, not the previous one.
		await edit('HEADER_V3', mutateFileInPlace);

		expect(
			await tabA.evaluate(
				() => document.getElementById('counter')?.textContent
			)
		).toBe('5');
		expect(
			await tabA.evaluate(() => Reflect.get(window, '__noReload'))
		).toBe(true);
		expect(
			await tabB.evaluate(() => Reflect.get(window, '__noReload'))
		).toBe(true);
		const fresh = await (await fetch(`${server.baseUrl}/layout-a`)).text();
		expect(fresh).toContain('HEADER_V3');
		expect(fresh).toContain('Layout A title');
	}, 120_000);
});
