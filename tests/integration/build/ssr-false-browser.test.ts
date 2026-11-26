import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import type { Page } from 'playwright';
import type { ComponentType } from 'react';
import type { Component as SvelteComponent } from 'svelte';
import { handleAngularPageRequest } from '../../../src/angular/pageHandler';
import { build } from '../../../src/core/build';
import { setCurrentIslandManifest } from '../../../src/core/islandPageContext';
import { handleReactPageRequest } from '../../../src/react/pageHandler';
import { handleSveltePageRequest } from '../../../src/svelte/pageHandler';
import { handleVuePageRequest } from '../../../src/vue/pageHandler';
import { openPage } from '../../helpers/browser';
import { ensureDistBuild } from '../../helpers/ensureDistBuild';
import { unservedPath } from '../../helpers/unservedPath';

/* `ssr: false` on a page handler: the server sends the shell and the
 * browser renders the page.
 *
 * Each fixture page reads `window` while it renders, which is the reason
 * anyone turns server rendering off — and what would throw if the server
 * rendered it after all. So the page appearing at all is half the
 * assertion; the other half is that the server's response carries none
 * of it, that the props still arrive, and that the page is live. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const fixtureRoot = join(repoRoot, '.test-builds', `ssr-false-${process.pid}`);

const REACT_PAGE = `import { useState } from 'react';

export const ClientOnlyReact = ({ label }: { label: string }) => {
	const [count, setCount] = useState(0);
	// Throws on a server: there is no window there.
	const where = window.location.pathname;

	return (
		<html lang="en">
			<head>
				<title>React, client only</title>
			</head>
			<body>
				<main id="react-page">
					<p id="react-label">{label}</p>
					<p id="react-where">{where}</p>
					<button id="react-count" onClick={() => setCount(count + 1)}>
						count {count}
					</button>
				</main>
			</body>
		</html>
	);
};
`;

const SVELTE_PAGE = `<script lang="ts">
	let { label }: { label: string } = $props();
	let count = $state(0);
	// Throws on a server: there is no window there.
	const where = window.location.pathname;
</script>

<svelte:head><title>Svelte, client only</title></svelte:head>

<main id="svelte-page">
	<p id="svelte-label">{label}</p>
	<p id="svelte-where">{where}</p>
	<button id="svelte-count" onclick={() => (count += 1)}>count {count}</button>
</main>

<style>
	#svelte-label {
		color: rgb(0, 0, 200);
	}
</style>
`;

const VUE_PAGE = `<script setup lang="ts">
import { ref } from 'vue';

const { label } = defineProps<{ label: string }>();
const count = ref(0);
// Throws on a server: there is no window there.
const where = window.location.pathname;
</script>

<template>
	<main id="vue-page">
		<p id="vue-label">{{ label }}</p>
		<p id="vue-where">{{ where }}</p>
		<button id="vue-count" @click="count += 1">count {{ count }}</button>
	</main>
</template>

<style scoped>
#vue-label {
	color: rgb(200, 0, 0);
}
</style>
`;

/* Angular takes its data as a request context rather than props, so its
 * page shows the context's label. */
const ANGULAR_PAGE = `import { Component } from '@angular/core';
import { usePageContext } from '${resolve(import.meta.dir, '../../../src/angular/composables/usePageContext').replace(/\\/g, '/')}';

@Component({
	selector: 'client-only-angular',
	standalone: true,
	template: \`
		<main id="angular-page">
			<p id="angular-label">{{ label }}</p>
			<p id="angular-where">{{ where }}</p>
			<button id="angular-count" (click)="count = count + 1">count {{ count }}</button>
		</main>
	\`
})
export class ClientOnlyAngular {
	count = 0;
	label = usePageContext<{ label: string }>()?.label ?? '';
	// Throws on a server: there is no window there.
	where = window.location.pathname;
}
`;

type ReactPage = ComponentType<{ label: string }>;
type Served = { baseUrl: string; stop: () => void };

let app: Served | undefined;

const isReactPage = (value: unknown): value is ReactPage =>
	typeof value === 'function';

const contentType = (path: string) => {
	if (path.endsWith('.js')) return 'text/javascript; charset=utf-8';
	if (path.endsWith('.css')) return 'text/css; charset=utf-8';

	return 'application/octet-stream';
};

const createApp = (
	buildDir: string,
	manifest: Record<string, string>,
	ReactComponent: ReactPage
) => {
	const renderPage = (request: Request) => {
		const { pathname } = new URL(request.url);
		/* The build manifest is one global per process, and the test files
		 * in a shard share a process. A client-only page gets the island
		 * runtime whenever that manifest has one, so without this the
		 * page was handed the bootstrap of whichever fixture ran last —
		 * a file this build never produced, and a 404 in the console.
		 * Which file ran last depends on how the shard was dealt, so it
		 * failed some nights and not others. */
		setCurrentIslandManifest(manifest, buildDir);
		if (pathname === '/react')
			return handleReactPageRequest({
				index: manifest.ClientOnlyReactIndex ?? '',
				Page: ReactComponent,
				props: { label: 'REACT_PROP' },
				request,
				ssr: false
			});
		if (pathname === '/svelte')
			return handleSveltePageRequest<SvelteComponent<{ label: string }>>({
				indexPath: manifest.ClientOnlySvelteIndex ?? '',
				pagePath: manifest.ClientOnlySvelte ?? '',
				props: { label: 'SVELTE_PROP' },
				request,
				ssr: false
			});
		if (pathname === '/angular')
			return handleAngularPageRequest({
				headTag: '<head><title>Angular, client only</title></head>',
				indexPath: manifest.ClientOnlyAngularIndex ?? '',
				pagePath: manifest.ClientOnlyAngular ?? '',
				request,
				requestContext: { label: 'ANGULAR_PROP' },
				ssr: false
			});
		if (pathname === '/vue')
			return handleVuePageRequest({
				headTag: '<head><title>Vue, client only</title></head>',
				indexPath: manifest.ClientOnlyVueIndex ?? '',
				pagePath: manifest.ClientOnlyVue ?? '',
				props: { label: 'VUE_PROP' },
				request,
				ssr: false
			});

		return unservedPath(pathname);
	};

	return async (request: Request) => {
		const { pathname } = new URL(request.url);
		if (extname(pathname) === '') return renderPage(request);
		const filePath = join(buildDir, pathname);
		if (!existsSync(filePath)) return new Response(null, { status: 404 });

		return new Response(Bun.file(filePath), {
			headers: { 'Content-Type': contentType(filePath) }
		});
	};
};

beforeAll(async () => {
	await ensureDistBuild();
	const write = async (path: string, content: string) => {
		await mkdir(join(fixtureRoot, path, '..'), { recursive: true });
		await writeFile(join(fixtureRoot, path), content);
	};
	await write('angular/pages/client-only-angular.ts', ANGULAR_PAGE);
	await write('react/pages/ClientOnlyReact.tsx', REACT_PAGE);
	await write('svelte/pages/ClientOnlySvelte.svelte', SVELTE_PAGE);
	await write('vue/pages/ClientOnlyVue.vue', VUE_PAGE);

	const rel = (path: string) =>
		relative(process.cwd(), join(fixtureRoot, path));
	const result = await build({
		angularDirectory: rel('angular'),
		buildDirectory: rel('build'),
		mode: 'production',
		options: { throwOnError: true },
		reactDirectory: rel('react'),
		svelteDirectory: rel('svelte'),
		vueDirectory: rel('vue')
	});
	const pageModule: unknown = await import(
		join(fixtureRoot, 'react', 'pages', 'ClientOnlyReact.tsx')
	);
	const ReactComponent: unknown =
		typeof pageModule === 'object' && pageModule !== null
			? Reflect.get(pageModule, 'ClientOnlyReact')
			: undefined;
	if (!isReactPage(ReactComponent))
		throw new Error('ClientOnlyReact did not load');

	const server = Bun.serve({
		fetch: createApp(
			join(fixtureRoot, 'build'),
			result?.manifest ?? {},
			ReactComponent
		),
		port: 0
	});
	app = {
		baseUrl: `http://localhost:${server.port}`,
		stop: () => server.stop(true)
	};
}, 240_000);

afterAll(async () => {
	app?.stop();
	await rm(fixtureRoot, { force: true, recursive: true });
});

const urlOf = (path: string) => {
	if (!app) throw new Error('fixture app is not running');

	return `${app.baseUrl}${path}`;
};

type PageLog = { entries: string[] };

/* A console error for a failed request says "the server responded with
 * a status of 404" and not for what; the address is on the message's
 * location. The response listener names it too, for a request the
 * console never mentions. */
const record = (log: PageLog) => (page: Page) => {
	page.on('console', (message) => {
		if (message.type() === 'error')
			log.entries.push(
				`console.error: ${message.text()} (${message.location().url})`
			);
	});
	page.on('response', (response) => {
		if (response.status() >= 400)
			log.entries.push(`http ${response.status()}: ${response.url()}`);
	});
	page.on('pageerror', (error) => {
		log.entries.push(`pageerror: ${error.message}`);
	});
};

describe.each([
	['angular', 'ANGULAR_PROP'],
	['react', 'REACT_PROP'],
	['svelte', 'SVELTE_PROP'],
	['vue', 'VUE_PROP']
] as const)('a %s page with ssr: false', (framework, prop) => {
	test('is not in the server response', async () => {
		const response = await fetch(urlOf(`/${framework}`));
		const html = await response.text();

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toContain('text/html');
		// None of the page: not its markup, not the prop it would show.
		expect(html).not.toContain(`${framework}-page`);
		expect(html).not.toContain(`>${prop}<`);
		// What makes the browser render it rather than hydrate nothing.
		expect(html).toContain('window.__ABSOLUTE_PAGE_RENDER_MODE__="client"');
		// The props are handed over for the browser to render with.
		expect(html).toContain(prop);
	});

	test('renders in the browser, with its props, and is live', async () => {
		const log: PageLog = { entries: [] };
		const session = await openPage(urlOf(`/${framework}`), {
			onPage: record(log),
			waitUntil: 'load'
		});
		try {
			const { page } = session;
			await page.waitForSelector(`#${framework}-page`, {
				timeout: 30_000
			});

			expect(
				await page.locator(`#${framework}-label`).textContent()
			).toBe(prop);
			// Read from `window` during render: this ran in a browser.
			expect(
				await page.locator(`#${framework}-where`).textContent()
			).toBe(`/${framework}`);

			await page.click(`#${framework}-count`);
			await page.waitForFunction(
				(selector) =>
					document.querySelector(selector)?.textContent?.trim() ===
					'count 1',
				`#${framework}-count`,
				{ timeout: 10_000 }
			);

			// Rendered once: a second copy would mean it mounted beside
			// markup instead of into the empty root.
			expect(await page.locator(`#${framework}-page`).count()).toBe(1);
			expect(log.entries).toEqual([]);
		} finally {
			await session.close();
		}
	}, 120_000);
});

describe('what the shell still carries', () => {
	test('the head the handler was given', async () => {
		const vue = await (await fetch(urlOf('/vue'))).text();

		expect(vue).toContain('<title>Vue, client only</title>');
	});

	test('scoped styles apply once the page has mounted', async () => {
		const session = await openPage(urlOf('/svelte'), { waitUntil: 'load' });
		try {
			await session.page.waitForSelector('#svelte-label', {
				timeout: 30_000
			});

			expect(
				await session.page
					.locator('#svelte-label')
					.evaluate((element) => getComputedStyle(element).color)
			).toBe('rgb(0, 0, 200)');
		} finally {
			await session.close();
		}
	}, 120_000);
});
