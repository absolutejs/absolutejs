import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	symlink,
	writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ensureDistBuild } from '../../helpers/ensureDistBuild';

/* Partial prerendering under `absolute start`: routes listed in
 * `static.routes` are pre-rendered as a static shell, the shell is served
 * from the cache before the route handler runs, and only the slots marked
 * `dynamic` render per request, streamed into the shell already sent. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const CLI_ENTRY = join(repoRoot, 'dist', 'cli', 'index.js');
const PORT = 4605;
const SLOW_HANDLER_MS = 800;
const SLOW_HOLE_MS = 1500;
const FIRST_BYTE_BUDGET_MS = 250;

const REACT_PAGE = `import { StreamSlot } from '@absolutejs/absolute/react/components';

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

export const ReactPartial = ({ user }: { user: string }) => (
	<html lang="en">
		<head>
			<title>React partial</title>
		</head>
		<body>
			<h1>react shell</h1>
			<StreamSlot
				fallbackHtml="<p>static loading</p>"
				id="react-static"
				resolve={() => \`<p>static built at \${Date.now()}</p>\`}
			/>
			<StreamSlot
				dynamic
				fallbackHtml="<p>user loading</p>"
				id="react-user"
				resolve={async () => {
					await wait(${SLOW_HOLE_MS});

					return \`<p>react hello \${user}</p>\`;
				}}
			/>
		</body>
	</html>
);
`;

const SVELTE_PAGE = `<script lang="ts">
	import StreamSlot from '@absolutejs/absolute/svelte/components/StreamSlot.svelte';

	let { user = 'guest' }: { user?: string } = $props();

	const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
	const greeting = (async () => {
		await wait(${SLOW_HOLE_MS});

		return \`svelte await \${user}\`;
	})();
</script>

<main>
	<h1>svelte shell</h1>
	<StreamSlot
		fallbackHtml="<p>static loading</p>"
		id="svelte-static"
		resolve={() => '<p>svelte static resolved</p>'}
	/>

	<!-- absolute:stream dynamic -->
	{#await greeting}
		<p>svelte user loading</p>
	{:then value}
		<p>{value}</p>
	{/await}
</main>
`;

const CONFIG = `import { defineConfig } from '@absolutejs/absolute';

export default defineConfig({
	buildDirectory: './build',
	reactDirectory: './react',
	static: { revalidate: 2, routes: ['/react', '/svelte'] },
	svelteDirectory: './svelte'
});
`;

const SERVER_TS = `import { Elysia } from 'elysia';
import { asset, networking, prepare, secureHeaders } from '@absolutejs/absolute';
import { handleReactPageRequest } from '@absolutejs/absolute/react/server';
import { handleSveltePageRequest } from '@absolutejs/absolute/svelte/server';
import { ReactPartial } from './react/pages/ReactPartial';

const { absolutejs, manifest } = await prepare();

const userFrom = (request: Request) =>
	request.headers.get('cookie')?.match(/user=(\\w+)/)?.[1] ?? 'guest';

export const server = new Elysia()
	.use(secureHeaders())
	.use(absolutejs)
	.get('/react', async ({ request }) => {
		// Slow static data: the cached shell doesn't wait for it.
		await new Promise((done) => setTimeout(done, ${SLOW_HANDLER_MS}));

		return handleReactPageRequest({
			collectStreamingSlots: true,
			index: asset(manifest, 'ReactPartialIndex'),
			Page: ReactPartial,
			props: { user: userFrom(request) }
		});
	})
	.get('/svelte', ({ request }) =>
		handleSveltePageRequest({
			collectStreamingSlots: true,
			indexPath: asset(manifest, 'SveltePartialIndex'),
			pagePath: asset(manifest, 'SveltePartial'),
			props: { user: userFrom(request) }
		})
	)
	.use(networking);
`;

let root = '';
let server: ReturnType<typeof Bun.spawn> | undefined;

/* The repo's node_modules may hold an older published
 * @absolutejs/absolute; link every package from it except that one, which
 * points at this checkout (its dist/). */
const linkNodeModules = async (projectRoot: string) => {
	const source = join(repoRoot, 'node_modules');
	const target = join(projectRoot, 'node_modules');
	await mkdir(join(target, '@absolutejs'), { recursive: true });
	const [entries, scoped] = await Promise.all([
		readdir(source),
		readdir(join(source, '@absolutejs'))
	]);
	await Promise.all([
		...entries
			.filter((name) => name !== '@absolutejs' && name !== '.bin')
			.map((name) => symlink(join(source, name), join(target, name))),
		...scoped
			.filter((name) => name !== 'absolute' && !name.startsWith('.'))
			.map((name) =>
				symlink(
					join(source, '@absolutejs', name),
					join(target, '@absolutejs', name)
				)
			),
		symlink(repoRoot, join(target, '@absolutejs', 'absolute'))
	]);
};

const waitForServer = async (attempt = 0): Promise<void> => {
	if (attempt >= 480) throw new Error('production server did not start');
	const ok = await fetch(`http://localhost:${PORT}/react`, {
		headers: { 'X-Absolute-Prerender-Bypass': '1' }
	})
		.then(async (response) => {
			await response.body?.cancel();

			return true;
		})
		.catch(() => false);
	if (ok) return;
	await Bun.sleep(250);
	await waitForServer(attempt + 1);
};

type Timed = {
	firstByteMs: number;
	firstChunk: string;
	headers: Headers;
	text: string;
	totalMs: number;
};

const getTimed = async (
	path: string,
	headers: Record<string, string> = {}
): Promise<Timed> => {
	const started = performance.now();
	const response = await fetch(`http://localhost:${PORT}${path}`, {
		headers
	});
	const reader = response.body?.getReader();
	if (!reader) throw new Error('no body');
	const decoder = new TextDecoder();
	const first = await reader.read();
	const firstByteMs = performance.now() - started;
	const firstChunk = decoder.decode(first.value, { stream: true });
	const readRest = async (text: string): Promise<string> => {
		const next = await reader.read();
		if (next.done) return text;

		return readRest(text + decoder.decode(next.value, { stream: true }));
	};
	const text = await readRest(firstChunk);

	return {
		firstByteMs,
		firstChunk,
		headers: response.headers,
		text,
		totalMs: performance.now() - started
	};
};

const prerendered = (name: string) => join(root, 'dist', '_prerendered', name);

const results: Record<string, Timed> = {};

beforeAll(async () => {
	await ensureDistBuild();
	root = await mkdtemp(join(tmpdir(), 'absolute-partial-prerender-'));
	await mkdir(join(root, 'react', 'pages'), { recursive: true });
	await mkdir(join(root, 'svelte', 'pages'), { recursive: true });
	await writeFile(
		join(root, 'react', 'pages', 'ReactPartial.tsx'),
		REACT_PAGE
	);
	await writeFile(
		join(root, 'svelte', 'pages', 'SveltePartial.svelte'),
		SVELTE_PAGE
	);
	await writeFile(join(root, 'absolute.config.ts'), CONFIG);
	await writeFile(join(root, 'server.ts'), SERVER_TS);
	await writeFile(
		join(root, 'package.json'),
		JSON.stringify({ name: 'partial-prerender-fixture', type: 'module' })
	);
	await writeFile(
		join(root, 'tsconfig.json'),
		JSON.stringify({ compilerOptions: { jsx: 'react-jsx' } })
	);
	await linkNodeModules(root);

	server = Bun.spawn(['bun', CLI_ENTRY, 'start', 'server.ts'], {
		cwd: root,
		env: {
			...process.env,
			FORCE_COLOR: '0',
			NODE_ENV: 'production',
			PORT: String(PORT),
			TELEMETRY_OFF: '1'
		},
		stderr: 'inherit',
		stdout: 'inherit'
	});
	await waitForServer();

	results.reactAda = await getTimed('/react', { cookie: 'user=ada' });
	results.reactBob = await getTimed('/react', { cookie: 'user=bob' });
	results.reactBypass = await getTimed('/react', {
		cookie: 'user=cy',
		'X-Absolute-Prerender-Bypass': '1'
	});
	results.svelteAda = await getTimed('/svelte', { cookie: 'user=ada' });
}, 600_000);

afterAll(async () => {
	server?.kill();
	await server?.exited;
	if (root) await rm(root, { force: true, recursive: true });
});

describe('partial prerendering under absolute start', () => {
	test('the build stores each route as a shell with its holes', async () => {
		const reactShell = await readFile(prerendered('react.html'), 'utf-8');
		const svelteShell = await readFile(prerendered('svelte.html'), 'utf-8');

		expect(reactShell).toContain('static built at');
		expect(reactShell).toContain('user loading');
		expect(reactShell).not.toContain('react hello');
		expect(await readFile(prerendered('react.holes'), 'utf-8')).toBe(
			'react-user\n'
		);
		expect(svelteShell).toContain('svelte static resolved');
		expect(svelteShell).toContain('svelte user loading');
		expect(existsSync(prerendered('svelte.holes'))).toBe(true);
	});

	test('the React shell is served from cache before the slow handler and hole', () => {
		const ada = results.reactAda;
		const bypass = results.reactBypass;
		if (!ada || !bypass) throw new Error('missing responses');

		console.log(
			`[partial prerender] /react TTFB ${ada.firstByteMs.toFixed(1)}ms, complete ${ada.totalMs.toFixed(0)}ms; full SSR TTFB ${bypass.firstByteMs.toFixed(1)}ms`
		);
		expect(ada.firstByteMs).toBeLessThan(FIRST_BYTE_BUDGET_MS);
		expect(bypass.firstByteMs).toBeGreaterThanOrEqual(SLOW_HANDLER_MS - 50);
		expect(ada.firstChunk).toContain('react shell');
		expect(ada.firstChunk).toContain('static built at');
		expect(ada.firstChunk).not.toContain('react hello');
		expect(ada.totalMs).toBeGreaterThanOrEqual(SLOW_HOLE_MS - 50);
		expect(ada.headers.get('x-absolute-partial-prerender')).toBe('shell');
		expect(ada.headers.get('cache-control')).toBe('private, no-cache');
	});

	test('each request streams its own holes; static slots stay as built', () => {
		const ada = results.reactAda;
		const bob = results.reactBob;
		if (!ada || !bob) throw new Error('missing responses');
		const builtAt = (text: string) =>
			text.match(/static built at (\d+)/)?.[1];

		expect(ada.text).toContain('react hello ada');
		expect(bob.text).toContain('react hello bob');
		expect(bob.text).not.toContain('react hello ada');
		expect(builtAt(ada.text)).toBe(builtAt(bob.text));
		expect(ada.text.trimEnd().endsWith('</html>')).toBe(true);
	});

	test('the shell and the patches carry the request nonce', () => {
		const ada = results.reactAda;
		if (!ada) throw new Error('missing response');
		const nonce = ada.headers
			.get('content-security-policy')
			?.match(/'nonce-([^']+)'/)?.[1];
		const scriptNonces = [
			...ada.text.matchAll(/<script[^>]*\snonce="([^"]+)"/g)
		].map((match) => match[1]);

		expect(nonce).toBeDefined();
		expect(scriptNonces.length).toBeGreaterThan(2);
		expect(scriptNonces.every((value) => value === nonce)).toBe(true);
	});

	test('the Svelte await hole streams per request into its shell', () => {
		const ada = results.svelteAda;
		if (!ada) throw new Error('missing response');

		console.log(
			`[partial prerender] /svelte TTFB ${ada.firstByteMs.toFixed(1)}ms, complete ${ada.totalMs.toFixed(0)}ms`
		);
		expect(ada.firstByteMs).toBeLessThan(FIRST_BYTE_BUDGET_MS);
		expect(ada.firstChunk).toContain('svelte static resolved');
		expect(ada.firstChunk).not.toContain('svelte await ada');
		expect(ada.text).toContain('svelte await ada');
		expect(ada.totalMs).toBeGreaterThanOrEqual(SLOW_HOLE_MS - 50);
	});

	test('revalidation re-captures the shell and keeps its holes', async () => {
		const before = await readFile(prerendered('react.html'), 'utf-8');
		await Bun.sleep(2_100);
		// A stale shell is still served, and starts the re-render.
		const stale = await getTimed('/react', { cookie: 'user=dee' });
		await Bun.sleep(SLOW_HANDLER_MS + 1_000);
		const after = await readFile(prerendered('react.html'), 'utf-8');

		expect(stale.text).toContain('react hello dee');
		expect(after).not.toBe(before);
		expect(after).toContain('user loading');
		expect(after).not.toContain('react hello');
		expect(await readFile(prerendered('react.holes'), 'utf-8')).toBe(
			'react-user\n'
		);
	}, 30_000);
});
