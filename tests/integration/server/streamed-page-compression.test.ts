import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import {
	mkdir,
	mkdtemp,
	readdir,
	rm,
	symlink,
	writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/* Streamed pages, compressed (`compression: { streaming: true }`), under
 * `absolute start`.
 *
 * Every React, Svelte and Vue page is rendered as a stream, and was sent
 * with no `content-encoding`: the compressor for a buffered page needs
 * the whole body. A streamed page is now compressed as it streams.
 *
 * What needs a real server is everything around the compressor. A page's
 * HTML is read again inside the server in several places — its Markdown,
 * `llms-full.txt`, a pre-rendered shell with holes, a handler wrapped to
 * add streamed slots — and each of those must still be handed HTML, not
 * compressed bytes.
 *
 * The CLI and the framework are this checkout's sources. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const CLI_ENTRY = join(repoRoot, 'src', 'cli', 'index.ts');
const fromSource = (path: string) =>
	join(repoRoot, 'src', path).replace(/\\/g, '/');
const PORT = 4661;

const page = (body: string, imports = '') => `${imports}
export default function Page() {
	return (
		<html lang="en">
			<head>
				<meta charSet="utf-8" />
				<title>A title is not the page’s text</title>
			</head>
			<body>
				${body}
				<script>{'var notText = "these words are in a script";'}</script>
			</body>
		</html>
	);
}
`;

const FILES: Record<string, string> = {
	'absolute.config.ts': `import { defineConfig } from '${fromSource('index.ts')}';

export default defineConfig({
	buildDirectory: './build',
	compression: { streaming: true },
	fileRoutes: { output: './routes.gen.ts' },
	llms: { full: true, summary: 'An example site.', title: 'Acme' },
	markdown: true,
	static: { routes: ['/account', '/big'], revalidate: 1 },
	reactDirectory: './react',
	sitemap: { baseUrl: 'https://acme.test' }
});
`,
	'package.json': JSON.stringify({
		name: 'content-audit-fixture',
		type: 'module'
	}),
	// Pre-rendered, with a part that is the visitor's own.
	'react/routes/account.server.ts':
		"export const holes = { greeting: ({ request }: { request: Request }) => '<p>hello ' + (request.headers.get('x-user') ?? 'guest') + '</p>' };\n",
	'react/routes/account.tsx': page(
		'<main><h1>Account</h1>{Array.from({ length: 80 }, (_, i) => <p key={i}>The quick brown fox jumps over the lazy dog.</p>)}<StreamSlot dynamic fallbackHtml="<p>greeting loading</p>" id="greeting" /></main>',
		"import { StreamSlot } from '@absolutejs/absolute/react/components';\n"
	),
	// Not rendered on the server at all.
	'react/routes/app.server.ts':
		"export const ssr = false;\n\nexport const load = () => ({ plan: 'pro' });\n\nexport const markdown = ({ data }: { data: { plan: string } }) => '# The app\\n\\nYou are on the ' + data.plan + ' plan.';\n",
	'react/routes/app.tsx': page(
		'<main>an app with eight words of its own</main>'
	),
	'react/routes/big.tsx': page(
		'<main><h1>Big</h1>{Array.from({ length: 80 }, (_, i) => <p key={i}>The quick brown fox jumps over the lazy dog.</p>)}</main>'
	),
	'react/routes/blog/[slug].tsx': page('<main>a post</main>'),
	// The heading is rendered; the list is a streamed slot.
	'react/routes/feed.server.ts':
		"export const holes = { latest: async () => '<ul><li>the newest post of them all</li></ul>' };\n",
	'react/routes/feed.tsx': page(
		'<h1>Feed</h1><StreamSlot fallbackHtml="<p>loading</p>" id="latest" />',
		"import { StreamSlot } from '@absolutejs/absolute/react/components';\n"
	),
	'react/routes/index.tsx': page(
		'<main><h1>Acme anvils</h1><p>Made to order &amp; shipped by rail.</p></main>'
	),
	// Renders nothing until it has fetched, which no marker says.
	'react/routes/late.tsx': page(
		'<main>{text}</main>',
		"import { useEffect, useState } from 'react';\n"
	).replace(
		'\treturn (',
		"\tconst [text, setText] = useState('');\n\tuseEffect(() => setText('fetched in the browser'), []);\n\n\treturn ("
	),
	// The shell at once, and a slot that takes its time.
	'react/routes/slow.server.ts':
		'export const holes = { late: async () => { await Bun.sleep(600); return \'<p id="late">arrived late</p>\'; } };\n',
	'react/routes/slow.tsx': page(
		'<main><h1>Slow</h1>{Array.from({ length: 80 }, (_, i) => <p key={i}>The quick brown fox jumps over the lazy dog.</p>)}<StreamSlot fallbackHtml="<p>loading</p>" id="late" /></main>',
		"import { StreamSlot } from '@absolutejs/absolute/react/components';\n"
	),
	'server.ts': `import { Elysia } from 'elysia';
import { compressResponses, fileRoutes, networking, prepare } from '${fromSource('index.ts')}';
import { routeTree } from './routes.gen';

const { absolutejs, manifest } = await prepare();

export const server = new Elysia()
	.use(absolutejs)
	// Before the routes it covers: the pages and the API alike.
	.use(compressResponses())
	.use(fileRoutes(routeTree, manifest))
	.get('/api/items', ({ cookie }) => {
		const { visit } = cookie;
		if (visit) visit.value = 'counted';

		return Array.from({ length: 80 }, (_, id) => ({ id, name: 'item number ' + id }));
	})
	.get('/api/tiny', () => ({ ok: true }))
	.get('/api/events', function* () {
		yield 'first ';
		yield 'plain text line. '.repeat(120);
	})
	.get('/ready', () => 'ready')
	.use(networking);
`,
	'tsconfig.json': JSON.stringify({
		compilerOptions: {
			jsx: 'react-jsx',
			paths: {
				'@absolutejs/absolute': [fromSource('index.ts')],
				'@absolutejs/absolute/client': [fromSource('client/index.ts')],
				'@absolutejs/absolute/client/navigation': [
					fromSource('client/navigation.ts')
				],
				'@absolutejs/absolute/react': [fromSource('react/index.ts')],
				'@absolutejs/absolute/react/components': [
					fromSource('react/components/index.ts')
				],
				'@absolutejs/absolute/react/server': [
					fromSource('react/server.ts')
				]
			}
		}
	})
};

let root = '';
let server: ReturnType<typeof Bun.spawn> | undefined;

const linkNodeModules = async (projectRoot: string) => {
	const source = join(repoRoot, 'node_modules');
	const target = join(projectRoot, 'node_modules');
	await mkdir(target, { recursive: true });
	const entries = await readdir(source);
	await Promise.all(
		entries
			.filter((name) => name !== '.bin')
			.map((name) => symlink(join(source, name), join(target, name)))
	);
};

const url = (path: string) => `http://localhost:${PORT}${path}`;

const waitForServer = async (attempt = 0): Promise<void> => {
	if (attempt >= 480) throw new Error('production server did not start');
	const up = await fetch(url('/ready'))
		.then(async (response) => {
			await response.body?.cancel();

			return response.ok;
		})
		.catch(() => false);
	if (up) return;
	await Bun.sleep(250);
	await waitForServer(attempt + 1);
};

beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), 'absolute-content-audit-'));
	await Promise.all(
		Object.entries(FILES).map(async ([path, contents]) => {
			await mkdir(join(root, path, '..'), { recursive: true });
			await writeFile(join(root, path), contents);
		})
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
}, 600_000);

afterAll(async () => {
	server?.kill();
	await server?.exited;
	if (root) await rm(root, { force: true, recursive: true });
});

type Wire = {
	bytes: Uint8Array;
	encoding: string | null;
	status: number;
	vary: string | null;
};

/* The bytes as they were sent: `fetch` would decode them and hide
 * whether the wire was compressed at all. */
const wire = async (path: string, headers: Record<string, string> = {}) => {
	const response = await fetch(url(path), {
		decompress: false,
		headers: { 'accept-encoding': 'br, gzip', ...headers }
	} as RequestInit);
	const result: Wire = {
		bytes: new Uint8Array(await response.arrayBuffer()),
		encoding: response.headers.get('content-encoding'),
		status: response.status,
		vary: response.headers.get('vary')
	};

	return result;
};

const decoded = ({ bytes, encoding }: Wire) => {
	if (encoding === 'br') return brotliDecompressSync(bytes).toString();
	if (encoding === 'gzip') return gunzipSync(bytes).toString();

	return new TextDecoder().decode(bytes);
};

const identity = async (path: string) =>
	decoded(await wire(path, { 'accept-encoding': 'identity' }));

describe('a streamed page', () => {
	test('is sent as brotli, and decodes to the page', async () => {
		const sent = await wire('/big');

		expect(sent.status).toBe(200);
		expect(sent.encoding).toBe('br');
		expect(sent.vary).toContain('accept-encoding');
		expect(decoded(sent)).toBe(await identity('/big'));
		// 5 KB of repeated sentences: far smaller on the wire.
		expect(sent.bytes.byteLength).toBeLessThan(1500);
	});

	test('is sent as gzip to a client that does not accept brotli', async () => {
		const sent = await wire('/big', { 'accept-encoding': 'gzip' });

		expect(sent.encoding).toBe('gzip');
		expect(decoded(sent)).toContain('<h1>Big</h1>');
	});

	test('is sent as it is to a client that accepts neither', async () => {
		const sent = await wire('/big', { 'accept-encoding': 'identity' });

		expect(sent.encoding).toBeNull();
		expect(decoded(sent)).toContain('<h1>Big</h1>');
	});

	/* The point of streaming. The slot resolves 600 ms after the shell
	 * is written; compressing must not make the shell wait for it. */
	test('still sends its shell before a slow slot resolves', async () => {
		const started = performance.now();
		const response = await fetch(url('/slow'), {
			decompress: false,
			headers: { 'accept-encoding': 'br' }
		} as RequestInit);
		const reader = response.body?.getReader();
		const first = await reader?.read();
		const firstAt = performance.now() - started;
		const chunks = [first?.value ?? new Uint8Array()];
		for (;;) {
			const next = await reader?.read();
			if (!next || next.done) break;
			chunks.push(next.value);
		}
		const total = performance.now() - started;
		const html = brotliDecompressSync(Buffer.concat(chunks)).toString();

		expect(response.headers.get('content-encoding')).toBe('br');
		expect(html).toContain('<h1>Slow</h1>');
		expect(html).toContain('arrived late');
		expect(total).toBeGreaterThan(550);
		expect(firstAt).toBeLessThan(400);
	}, 30_000);

	test('answers HEAD with the headers of the GET, and no body', async () => {
		const response = await fetch(url('/big'), {
			headers: { 'accept-encoding': 'br' },
			method: 'HEAD'
		});

		expect(response.status).toBe(200);
		expect((await response.arrayBuffer()).byteLength).toBe(0);
	});
});

/* Each of these reads a page's HTML again inside the server. */
describe('what reads a page inside the server is still handed HTML', () => {
	test('the page as Markdown', async () => {
		const response = await fetch(url('/big.md'), {
			headers: { 'accept-encoding': 'br, gzip' }
		});
		const text = await response.text();

		expect(response.status).toBe(200);
		expect(text).toStartWith('# Big\n\nThe quick brown fox');
	});

	test('llms-full.txt', async () => {
		const response = await fetch(url('/llms-full.txt'), {
			headers: { 'accept-encoding': 'br, gzip' }
		});
		const text = await response.text();

		expect(text).toContain('# Big');
		expect(text).toContain('arrived late');
	}, 30_000);

	test('a pre-rendered shell with a part of the visitor’s own', async () => {
		const sent = await wire('/account', { 'x-user': 'ada' });
		const html = decoded(sent);

		expect(sent.status).toBe(200);
		expect(html).toContain('<h1>Account</h1>');
		expect(html).toContain('hello ada');
	});
});

/* `/big` is pre-rendered: a file, sent as a kept compressed copy. */
describe('a pre-rendered page', () => {
	test('is sent compressed, and decodes to the page', async () => {
		const sent = await wire('/big');

		expect(sent.encoding).toBe('br');
		expect(sent.vary).toContain('accept-encoding');
		expect(decoded(sent)).toBe(await identity('/big'));
		expect(decoded(sent)).toContain('<h1>Big</h1>');
	});

	test('is sent the same bytes the second time, and gzip when asked', async () => {
		const first = await wire('/big');
		const second = await wire('/big');
		const gzip = await wire('/big', { 'accept-encoding': 'gzip' });

		expect(Buffer.from(second.bytes).equals(Buffer.from(first.bytes))).toBe(
			true
		);
		expect(gzip.encoding).toBe('gzip');
		expect(decoded(gzip)).toBe(decoded(first));
	});

	test('with a part of the visitor’s own is compressed as it streams', async () => {
		const sent = await wire('/account', { 'x-user': 'ada' });

		expect(sent.encoding).toBe('br');
		expect(decoded(sent)).toContain('hello ada');
	});
});

/* Answered by the framework's own plugins before any route runs, so no
 * route of the app holds them: compressed by default. */
describe('the framework’s own text responses', () => {
	test('a page as Markdown is sent compressed, and decodes to the Markdown', async () => {
		const sent = await wire('/big.md');

		expect(sent.encoding).toBe('br');
		expect(sent.vary).toContain('Accept');
		expect(sent.vary).toContain('Accept-Encoding');
		expect(decoded(sent)).toStartWith('# Big\n\nThe quick brown fox');
		expect(decoded(sent)).toBe(
			decoded(await wire('/big.md', { 'accept-encoding': 'identity' }))
		);
	});

	test('llms-full.txt is sent compressed, gzip when brotli is not accepted', async () => {
		const brotli = await wire('/llms-full.txt');
		const gzip = await wire('/llms-full.txt', {
			'accept-encoding': 'gzip'
		});

		expect(brotli.encoding).toBe('br');
		expect(gzip.encoding).toBe('gzip');
		expect(decoded(gzip)).toBe(decoded(brotli));
		expect(decoded(brotli)).toContain('# Big');
	}, 30_000);

	test('neither is compressed for a client that accepts no encoding', async () => {
		expect(
			(await wire('/big.md', { 'accept-encoding': 'identity' })).encoding
		).toBeNull();
		expect(
			(await wire('/llms-full.txt', { 'accept-encoding': 'identity' }))
				.encoding
		).toBeNull();
	}, 30_000);
});

/* `compressResponses()`, mounted after the framework and before the
 * routes. Every response below passes through it. */
describe('the app’s own routes, with compressResponses()', () => {
	test('JSON is compressed, with the route’s cookie', async () => {
		const response = await fetch(url('/api/items'), {
			decompress: false,
			headers: { 'accept-encoding': 'br, gzip' }
		} as RequestInit);
		const bytes = Buffer.from(await response.arrayBuffer());
		const items: unknown = JSON.parse(
			brotliDecompressSync(bytes).toString()
		);

		expect(response.headers.get('content-encoding')).toBe('br');
		expect(response.headers.get('set-cookie')).toContain('visit=counted');
		expect(Array.isArray(items) && items.length).toBe(80);
	});

	test('a small answer and a generator’s stream are sent as they are', async () => {
		const tiny = await wire('/api/tiny');
		const events = await wire('/api/events');

		expect(tiny.encoding).toBeNull();
		expect(JSON.parse(decoded(tiny))).toEqual({ ok: true });
		expect(events.encoding).toBeNull();
		expect(decoded(events)).toStartWith('first plain text line.');
	});

	/* A page is the page path's to compress. Here it already is, and the
	 * plugin leaves it be; one it would not compress, it does not touch. */
	test('pages are left to the page path, and still decode to the page', async () => {
		const compressed = await wire('/big');
		const plain = await wire('/big', { 'accept-encoding': 'identity' });

		expect(compressed.encoding).toBe('br');
		expect(decoded(compressed)).toBe(decoded(plain));
		expect(plain.encoding).toBeNull();
	});

	test('the framework’s own text responses are compressed once, not twice', async () => {
		const markdown = await wire('/big.md');

		expect(markdown.encoding).toBe('br');
		expect(decoded(markdown)).toStartWith('# Big');
	});
});
