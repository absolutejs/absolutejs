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

/* Routes in `static.routes` whose static (non-dynamic) streaming slots
 * resolve asynchronously are still pre-rendered: the capture waits for those
 * slots and for the end of the stream, so the shell keeps its closing
 * </body></html>. A route that can't be pre-rendered is reported once at
 * `absolute start`, naming it and the reason, and still renders per request. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const CLI_ENTRY = join(repoRoot, 'dist', 'cli', 'index.js');
const PORT = 4607;
const SLOW_HANDLER_MS = 800;
const STATIC_SLOT_MS = 300;

const REACT_PAGE = `import { StreamSlot, SuspenseSlot } from '@absolutejs/absolute/react/components';

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

export const ReactAsyncStatic = () => (
	<html lang="en">
		<head>
			<title>React async static</title>
		</head>
		<body>
			<h1>react async shell</h1>
			<StreamSlot
				fallbackHtml="<p>react static loading</p>"
				id="react-async-static"
				resolve={async () => {
					await wait(${STATIC_SLOT_MS});

					return \`<p>react async built at \${Date.now()}</p>\`;
				}}
			/>
			<SuspenseSlot
				fallback={<p>react suspense loading</p>}
				id="react-async-suspense"
				resolve={async () => {
					await wait(${STATIC_SLOT_MS});

					return <p>react suspense resolved</p>;
				}}
			/>
		</body>
	</html>
);
`;

const SVELTE_PAGE = `<script lang="ts">
	import StreamSlot from '@absolutejs/absolute/svelte/components/StreamSlot.svelte';

	const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
	const resolveStatic = async () => {
		await wait(${STATIC_SLOT_MS});

		return \`<p>svelte async built at \${Date.now()}</p>\`;
	};
</script>

<main>
	<h1>svelte async shell</h1>
	<StreamSlot
		fallbackHtml="<p>svelte static loading</p>"
		id="svelte-async-static"
		resolve={resolveStatic}
	/>
</main>
`;

const CONFIG = `import { defineConfig } from '@absolutejs/absolute';

export default defineConfig({
	buildDirectory: './build',
	reactDirectory: './react',
	static: { routes: ['/react-async', '/svelte-async', '/build-broken'] },
	svelteDirectory: './svelte'
});
`;

const SERVER_TS = `import { Elysia } from 'elysia';
import { asset, isPrerendering, networking, prepare } from '@absolutejs/absolute';
import { handleReactPageRequest } from '@absolutejs/absolute/react/server';
import { handleSveltePageRequest } from '@absolutejs/absolute/svelte/server';
import { ReactAsyncStatic } from './react/pages/ReactAsyncStatic';

const { absolutejs, manifest } = await prepare();

const slow = () => new Promise((done) => setTimeout(done, ${SLOW_HANDLER_MS}));

export const server = new Elysia()
	.use(absolutejs)
	.get('/react-async', async () => {
		await slow();

		return handleReactPageRequest({
			collectStreamingSlots: true,
			index: asset(manifest, 'ReactAsyncStaticIndex'),
			Page: ReactAsyncStatic
		});
	})
	.get('/svelte-async', async () => {
		await slow();

		return handleSveltePageRequest({
			collectStreamingSlots: true,
			indexPath: asset(manifest, 'SvelteAsyncStaticIndex'),
			pagePath: asset(manifest, 'SvelteAsyncStatic')
		});
	})
	.get('/build-broken', () => {
		// Only the pre-render server fails: the route itself works.
		if (isPrerendering()) {
			return new Response('unavailable while pre-rendering', { status: 503 });
		}

		return new Response('<!doctype html><html><body><p>broken route rendered</p></body></html>', {
			headers: { 'content-type': 'text/html' }
		});
	})
	.use(networking);
`;

let root = '';
let server: ReturnType<typeof Bun.spawn> | undefined;
let output = '';

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

const collect = (stream: ReadableStream<Uint8Array> | null | undefined) => {
	if (!stream) return;
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	const read = (): Promise<void> =>
		reader.read().then(({ done, value }) => {
			if (done) return undefined;
			const text = decoder.decode(value, { stream: true });
			output += text;
			process.stdout.write(text);

			return read();
		});
	void read().catch(() => undefined);
};

const waitForServer = async (attempt = 0): Promise<void> => {
	if (attempt >= 480) throw new Error('production server did not start');
	const ok = await fetch(`http://localhost:${PORT}/build-broken`)
		.then(async (response) => {
			await response.body?.cancel();

			return response.ok;
		})
		.catch(() => false);
	if (ok) return;
	await Bun.sleep(250);
	await waitForServer(attempt + 1);
};

const prerendered = (name: string) => join(root, 'dist', '_prerendered', name);

type Timed = { ms: number; text: string };

const getTimed = async (path: string): Promise<Timed> => {
	const started = performance.now();
	const response = await fetch(`http://localhost:${PORT}${path}`);
	const text = await response.text();

	return { ms: performance.now() - started, text };
};

beforeAll(async () => {
	await ensureDistBuild();
	root = await mkdtemp(join(tmpdir(), 'absolute-ppr-async-static-'));
	await mkdir(join(root, 'react', 'pages'), { recursive: true });
	await mkdir(join(root, 'svelte', 'pages'), { recursive: true });
	await writeFile(
		join(root, 'react', 'pages', 'ReactAsyncStatic.tsx'),
		REACT_PAGE
	);
	await writeFile(
		join(root, 'svelte', 'pages', 'SvelteAsyncStatic.svelte'),
		SVELTE_PAGE
	);
	await writeFile(join(root, 'absolute.config.ts'), CONFIG);
	await writeFile(join(root, 'server.ts'), SERVER_TS);
	await writeFile(
		join(root, 'package.json'),
		JSON.stringify({ name: 'ppr-async-static-fixture', type: 'module' })
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
		stderr: 'pipe',
		stdout: 'pipe'
	});
	collect(server.stdout as ReadableStream<Uint8Array>);
	collect(server.stderr as ReadableStream<Uint8Array>);
	await waitForServer();
}, 600_000);

afterAll(async () => {
	server?.kill();
	await server?.exited;
	if (root) await rm(root, { force: true, recursive: true });
});

const builtAt = (framework: string, text: string) =>
	text.match(new RegExp(`${framework} async built at (\\d+)`))?.[1];

describe('static slots with async resolvers under partial prerendering', () => {
	test('the React route is pre-rendered with its async static slots inlined', async () => {
		expect(existsSync(prerendered('react-async.html'))).toBe(true);
		const shell = await readFile(prerendered('react-async.html'), 'utf-8');
		expect(shell).toContain('react async built at');
		expect(shell).toContain('react suspense resolved');
		expect(shell.trimEnd()).toMatch(/<\/body>\s*<\/html>$/i);
		expect(existsSync(prerendered('react-async.holes'))).toBe(false);

		const served = await getTimed('/react-async');
		// Served from the cache: the slow handler never ran.
		expect(served.ms).toBeLessThan(SLOW_HANDLER_MS);
		expect(builtAt('react', served.text)).toBe(builtAt('react', shell));
		expect(served.text).toContain('react suspense resolved');
		expect(served.text.trimEnd()).toMatch(/<\/body>\s*<\/html>$/i);
	});

	test('the Svelte route is pre-rendered with its async static slot inlined', async () => {
		expect(existsSync(prerendered('svelte-async.html'))).toBe(true);
		const shell = await readFile(prerendered('svelte-async.html'), 'utf-8');
		expect(shell).toContain('svelte async built at');
		expect(shell.trimEnd()).toMatch(/<\/body>\s*<\/html>$/i);

		const served = await getTimed('/svelte-async');
		expect(served.ms).toBeLessThan(SLOW_HANDLER_MS);
		expect(builtAt('svelte', served.text)).toBe(builtAt('svelte', shell));
		expect(served.text.trimEnd()).toMatch(/<\/body>\s*<\/html>$/i);
	});

	test('a route that cannot be pre-rendered is reported once and still renders', async () => {
		expect(existsSync(prerendered('build-broken.html'))).toBe(false);
		const warnings = output
			.split('\n')
			.filter((line) => line.includes('/build-broken'));
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain('HTTP 503');
		expect(output).not.toMatch(
			/Could not pre-render \/(react|svelte)-async/
		);

		const response = await fetch(`http://localhost:${PORT}/build-broken`);
		expect(response.status).toBe(200);
		expect(await response.text()).toContain('broken route rendered');
	});
});
