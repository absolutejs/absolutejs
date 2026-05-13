import { describe, expect, test, afterEach } from 'bun:test';
import { resolve } from 'node:path';
import { startDevServer, type DevServer } from '../../../helpers/devServer';
import { connectHMR, type HMRClient } from '../../../helpers/ws';
import { mutateFile, restoreAllFiles } from '../../../helpers/file';

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..', '..');
const TAILWIND_OUTPUT_PATH = '/assets/css/tailwind.generated.css';

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

/* When `config.tailwind` is set, the framework auto-injects an
 * `@source` directive for every configured framework directory and
 * runs the persistent Tailwind v4 compiler on every file change
 * Tailwind cares about (markup, scripts, stylesheets). The output
 * lands at `<buildDir>/<tailwind.output>` and is served at the
 * matching URL (`/assets/css/tailwind.generated.css` here).
 *
 * The Tailwind `style-update` broadcast carries `data.cause`: the
 * list of changed files (filtered to Tailwind candidates) that
 * triggered the regen. Tests filter by their own file's path so a
 * batch that also includes a sibling framework's afterEach restore
 * still matches if the expected file is somewhere in the cause
 * set. One dev server per test guards against the watcher coalescing
 * a prior test's afterEach restore with the current test's mutation
 * (the first style-update would then carry both files and a
 * downstream test would get a `cause` set that doesn't include its
 * file at all). */

const startAndConnect = async () => {
	server = await startDevServer();
	client = await connectHMR(server.port);
	await client.waitFor('manifest');
	await client.waitFor('connected');
	client.drain();
	return server;
};

const driveTailwindRegenFor = async (
	expectedFile: string,
	sentinel: string,
	srv: DevServer,
	c: HMRClient
) => {
	const resolvedExpected = resolve(expectedFile);
	while (true) {
		const msg = await c.waitFor('style-update', 30_000);
		const cause =
			(msg.data as { cause?: string[] })?.cause?.map((f) => resolve(f)) ??
			[];
		// Skip broadcasts whose cause set doesn't include our file
		// — a defensive guard, even though per-server isolation
		// makes this rare.
		if (!cause.includes(resolvedExpected)) continue;
		const res = await fetch(`${srv.baseUrl}${TAILWIND_OUTPUT_PATH}`);
		expect(res.status).toBe(200);
		const body = await res.text();
		if (body.includes(sentinel)) return body;
	}
};

describe('Tailwind class discovery per framework dir', () => {
	test('initial Tailwind output is served (auto-injected @source covers all framework dirs)', async () => {
		const srv = await startAndConnect();
		const res = await fetch(`${srv.baseUrl}${TAILWIND_OUTPUT_PATH}`);
		expect(res.status).toBe(200);
		const body = await res.text();
		expect(body).toMatch(/tailwindcss v4/i);
		expect(body).toContain('@layer');
	}, 60_000);

	test('HTML page edit lands a fresh utility in tailwind.generated.css', async () => {
		const srv = await startAndConnect();
		if (!client) throw new Error('client missing');
		const page = resolve(
			PROJECT_ROOT,
			'example/html/pages/HTMLExample.html'
		);
		mutateFile(page, (c) =>
			c.replace('<h1>', '<h1 class="text-[#ff00aa]">')
		);
		await driveTailwindRegenFor(page, '#ff00aa', srv, client);
	}, 60_000);

	test('HTMX page edit lands a fresh utility in tailwind.generated.css', async () => {
		const srv = await startAndConnect();
		if (!client) throw new Error('client missing');
		const page = resolve(
			PROJECT_ROOT,
			'example/htmx/pages/HTMXExample.html'
		);
		mutateFile(page, (c) =>
			c.replace('<h1>', '<h1 class="text-[#aa00ff]">')
		);
		await driveTailwindRegenFor(page, '#aa00ff', srv, client);
	}, 60_000);

	test('Angular template edit lands a fresh utility in tailwind.generated.css', async () => {
		const srv = await startAndConnect();
		if (!client) throw new Error('client missing');
		// `angular-example.html` is the page-shell template (just
		// renders `<app-dropdown>` + `<app-root>`). Mutate the
		// inner app component's template — that's where the real
		// markup tree lives.
		const template = resolve(
			PROJECT_ROOT,
			'example/angular/templates/app.component.html'
		);
		mutateFile(template, (c) =>
			c.replace('<h1>', '<h1 class="text-[#00aaff]">')
		);
		await driveTailwindRegenFor(template, '#00aaff', srv, client);
	}, 60_000);

	test('Svelte page edit lands a fresh utility in tailwind.generated.css', async () => {
		const srv = await startAndConnect();
		if (!client) throw new Error('client missing');
		const page = resolve(
			PROJECT_ROOT,
			'example/svelte/pages/SvelteExample.svelte'
		);
		mutateFile(page, (c) =>
			c.replace('<h1>', '<h1 class="text-[#0aff00]">')
		);
		await driveTailwindRegenFor(page, '#0aff00', srv, client);
	}, 60_000);

	test('Vue page edit lands a fresh utility in tailwind.generated.css', async () => {
		const srv = await startAndConnect();
		if (!client) throw new Error('client missing');
		const page = resolve(PROJECT_ROOT, 'example/vue/pages/VueExample.vue');
		mutateFile(page, (c) =>
			c.replace('<h1>', '<h1 class="text-[#0a00ff]">')
		);
		await driveTailwindRegenFor(page, '#0a00ff', srv, client);
	}, 60_000);
});
