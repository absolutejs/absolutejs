import { afterEach, describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { openPage, type BrowserSession } from '../../../helpers/browser';
import { startDevServer, type DevServer } from '../../../helpers/devServer';
import { createFile, mutateFile, restoreAllFiles } from '../../../helpers/file';
import { connectHMR } from '../../../helpers/ws';

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..', '..');
const REACT_DIR = resolve(PROJECT_ROOT, 'example/react');
const APP = resolve(REACT_DIR, 'components/App.tsx');
const DEEP = resolve(REACT_DIR, 'components/StaleSsrDeep1.tsx');
const HEADING = '<h1>AbsoluteJS + React</h1>';
const REACT_IMPORT = "import { useState } from 'react';";
const SSR_TIMEOUT_MS = 15_000;
const BROWSER_TIMEOUT_MS = 15_000;

let server: DevServer | undefined;
let closeClient: (() => void) | undefined;
let session: BrowserSession | undefined;

afterEach(async () => {
	await session?.close();
	session = undefined;
	closeClient?.();
	closeClient = undefined;
	await server?.kill();
	server = undefined;
	restoreAllFiles();
});

const start = async () => {
	const srv = await startDevServer();
	server = srv;
	const client = await connectHMR(srv.port);
	closeClient = () => client.close();
	await client.waitFor('manifest');
	await client.waitFor('connected');

	return srv;
};

type Page = { html: string; status: number };

/* React pages are rendered by the server entry, which the hot runtime
 * updates in place; there is no broadcast for the moment SSR catches up, so
 * poll the page (bounded) and hand back the last response either way. */
const fetchUntil = async (
	srv: DevServer,
	predicate: (page: Page) => boolean,
	route = '/react'
) => {
	const deadline = Date.now() + SSR_TIMEOUT_MS;
	let page: Page = { html: '', status: 0 };
	while (Date.now() < deadline) {
		const response = await fetch(`${srv.baseUrl}${route}`);
		page = {
			html: (await response.text()).replaceAll('<!-- -->', ''),
			status: response.status
		};
		if (predicate(page)) return page;
		await Bun.sleep(100);
	}

	return page;
};

/* Saving a component that is broken in a way that only shows when it runs,
 * then fixing it, must bring SSR back without restarting the dev server. */
describe('React SSR recovers once a broken component is fixed', () => {
	test('a component used before its import, then imported, renders', async () => {
		createFile(
			DEEP,
			'export const StaleSsrDeep1 = () => <p>DEEP1_RENDERED</p>;\n'
		);
		const srv = await start();
		session = await openPage(`${srv.baseUrl}/react`);
		const { page } = session;

		mutateFile(APP, (text) =>
			text.replace(HEADING, `${HEADING}\n\t\t\t<StaleSsrDeep1 />`)
		);
		const broken = await fetchUntil(srv, ({ html }) =>
			html.includes('StaleSsrDeep1 is not defined')
		);
		expect(broken.html).toContain('StaleSsrDeep1 is not defined');

		// Only an import line is added: the component's own statement keeps
		// its text, so the server must not keep the version that looked
		// `StaleSsrDeep1` up as a global.
		mutateFile(APP, (text) =>
			text.replace(
				REACT_IMPORT,
				`${REACT_IMPORT}\nimport { StaleSsrDeep1 } from './StaleSsrDeep1';`
			)
		);
		const fixed = await fetchUntil(
			srv,
			({ html, status }) =>
				status === 200 && html.includes('DEEP1_RENDERED')
		);
		expect(fixed.status).toBe(200);
		expect(fixed.html).toContain('DEEP1_RENDERED');
		expect(fixed.html).not.toContain('is not defined');

		// The page open since before the broken save shows the fix too.
		await page.waitForFunction(
			() => document.body.innerText.includes('DEEP1_RENDERED'),
			undefined,
			{ timeout: BROWSER_TIMEOUT_MS }
		);
	}, 90_000);

	test('a module-level throw keeps the last version serving; the fix renders', async () => {
		const srv = await start();

		mutateFile(APP, (text) =>
			text.replace(
				REACT_IMPORT,
				`${REACT_IMPORT}\nthrow new Error('TOP_LEVEL_PROBE');`
			)
		);
		// The version that throws is rolled back: the page keeps rendering.
		await Bun.sleep(1_000);
		const during = await fetchUntil(srv, ({ status }) => status === 200);
		expect(during.status).toBe(200);
		expect(during.html).toContain('AbsoluteJS + React');

		mutateFile(APP, (text) =>
			text
				.replace("\nthrow new Error('TOP_LEVEL_PROBE');", '')
				.replace(HEADING, '<h1>AbsoluteJS + React THROW_FIXED</h1>')
		);
		const fixed = await fetchUntil(
			srv,
			({ html, status }) => status === 200 && html.includes('THROW_FIXED')
		);
		expect(fixed.status).toBe(200);
		expect(fixed.html).toContain('THROW_FIXED');
	}, 90_000);
});

/* Svelte and Vue pages are recompiled and re-imported under a new URL on
 * each save, so the same sequence must recover there too. */
describe('Svelte and Vue SSR recover once a used component is imported', () => {
	test('svelte', async () => {
		createFile(
			resolve(
				PROJECT_ROOT,
				'example/svelte/components/StaleSsrDeep.svelte'
			),
			'<p>SVELTE_DEEP_RENDERED</p>\n'
		);
		const page = resolve(
			PROJECT_ROOT,
			'example/svelte/pages/SvelteExample.svelte'
		);
		const srv = await start();

		mutateFile(page, (text) =>
			text.replace(
				'<Counter {initialCount} />',
				'<Counter {initialCount} />\n\t<StaleSsrDeep />'
			)
		);
		const broken = await fetchUntil(
			srv,
			({ html }) => html.includes('StaleSsrDeep is not defined'),
			'/svelte'
		);
		expect(broken.html).toContain('StaleSsrDeep is not defined');

		mutateFile(page, (text) =>
			text.replace(
				"import Counter from '../components/Counter.svelte';",
				"import Counter from '../components/Counter.svelte';\n\timport StaleSsrDeep from '../components/StaleSsrDeep.svelte';"
			)
		);
		const fixed = await fetchUntil(
			srv,
			({ html, status }) =>
				status === 200 && html.includes('SVELTE_DEEP_RENDERED'),
			'/svelte'
		);
		expect(fixed.status).toBe(200);
		expect(fixed.html).toContain('SVELTE_DEEP_RENDERED');
	}, 90_000);

	test('vue', async () => {
		createFile(
			resolve(PROJECT_ROOT, 'example/vue/components/StaleSsrDeep.vue'),
			'<template><p>VUE_DEEP_RENDERED</p></template>\n'
		);
		const page = resolve(PROJECT_ROOT, 'example/vue/pages/VueExample.vue');
		const srv = await start();

		// Vue renders an unresolved component as an empty placeholder (and
		// warns), so a marker shows when the edit is being served.
		mutateFile(page, (text) =>
			text.replace(
				'<CountButton :initialCount="count" />',
				'<CountButton :initialCount="count" />\n\t\t<StaleSsrDeep />\n\t\t<p>VUE_EDIT_SERVED</p>'
			)
		);
		const unresolved = await fetchUntil(
			srv,
			({ html }) => html.includes('VUE_EDIT_SERVED'),
			'/vue'
		);
		expect(unresolved.html).toContain('VUE_EDIT_SERVED');
		expect(unresolved.html).not.toContain('VUE_DEEP_RENDERED');

		mutateFile(page, (text) =>
			text.replace(
				"import CountButton from '../components/CountButton.vue';",
				"import CountButton from '../components/CountButton.vue';\nimport StaleSsrDeep from '../components/StaleSsrDeep.vue';"
			)
		);
		const fixed = await fetchUntil(
			srv,
			({ html, status }) =>
				status === 200 && html.includes('VUE_DEEP_RENDERED'),
			'/vue'
		);
		expect(fixed.status).toBe(200);
		expect(fixed.html).toContain('VUE_DEEP_RENDERED');
	}, 90_000);
});
