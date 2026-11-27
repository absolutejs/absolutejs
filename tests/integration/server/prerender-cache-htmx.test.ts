import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
	copyFile,
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
import { openPage } from '../../helpers/browser';

/* A pre-rendered HTMX page, with `static.cache`, under `absolute start`.
 *
 * Two things, in the one fixture because they are how an HTMX page gets
 * what the other frameworks get from partial prerendering:
 *
 * - AN HTMX PAGE'S HOLES NEED NO MACHINERY. An element with `hx-get` and
 *   `hx-trigger="load"` is a hole: the page is pre-rendered as written,
 *   fallback and all, and the fragment is an ordinary route answered for
 *   each visitor. Nothing runs HTMX while the page is captured, so the
 *   fallback is what is stored.
 * - `static.cache` gives a pre-rendered page an `ETag`, a `304` and a
 *   public policy, so a CDN can keep it — which, for this page, is the
 *   whole of "edge mode": the shell cached, the holes fetched.
 *
 * The CLI and the fixture's imports are this checkout's sources. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const CLI_ENTRY = join(repoRoot, 'src', 'cli', 'index.ts');
const fromSource = (path: string) =>
	join(repoRoot, 'src', path).replace(/\\/g, '/');
const PORT = 4635;

const CONFIG = `import { defineConfig } from '${fromSource('index.ts')}';

export default defineConfig({
	buildDirectory: './build',
	htmxDirectory: './htmx',
	static: { cache: true, routes: ['/account'] }
});
`;

const PAGE = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>Account</title>
		<script src="/htmx.min.js"></script>
	</head>
	<body>
		<h1 id="heading">account shell</h1>
		<div id="greeting" hx-get="/fragments/greeting" hx-trigger="load" hx-swap="outerHTML">
			<p>greeting loading</p>
		</div>
	</body>
</html>
`;

const SERVER_TS = `import { Elysia } from 'elysia';
import { asset, handleHTMXPageRequest, networking, prepare } from '${fromSource('index.ts')}';

const { absolutejs, manifest } = await prepare();

const runs = { fragment: 0, page: 0 };

const userFrom = (request: Request) =>
	request.headers.get('cookie')?.match(/user=(\\w+)/)?.[1] ?? 'guest';

export const server = new Elysia()
	.use(absolutejs)
	.get('/account', () => {
		runs.page += 1;

		return handleHTMXPageRequest(asset(manifest, 'Account'));
	})
	.get('/fragments/greeting', ({ request }) => {
		runs.fragment += 1;

		return new Response(
			\`<p id="greeting">hello \${userFrom(request)}</p>\`,
			{ headers: { 'content-type': 'text/html; charset=utf-8' } }
		);
	})
	.get('/ready', () => 'ready')
	.get('/runs', () => runs)
	.use(networking);
`;

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
	root = await mkdtemp(join(tmpdir(), 'absolute-prerender-cache-htmx-'));
	await mkdir(join(root, 'htmx', 'pages'), { recursive: true });
	await writeFile(join(root, 'htmx', 'pages', 'Account.html'), PAGE);
	// An app ships its own htmx copy. With one framework directory
	// the build puts it at the root of its output: /htmx.min.js.
	await copyFile(
		join(repoRoot, 'src', 'cli', 'htmx', 'htmx.min.js'),
		join(root, 'htmx', 'htmx.2.0.11.min.js')
	);
	await writeFile(join(root, 'absolute.config.ts'), CONFIG);
	await writeFile(join(root, 'server.ts'), SERVER_TS);
	await writeFile(
		join(root, 'package.json'),
		JSON.stringify({ name: 'prerender-cache-htmx-fixture', type: 'module' })
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
}, 600_000);

afterAll(async () => {
	server?.kill();
	await server?.exited;
	if (root) await rm(root, { force: true, recursive: true });
});

type Runs = { fragment: number; page: number };

const runsNow = async () => {
	const response = await fetch(url('/runs'));
	const runs: Runs = await response.json();

	return runs;
};

describe('a pre-rendered HTMX page with a deferred fragment', () => {
	test('is stored with the fragment’s fallback in it: a shell', async () => {
		const stored = await readFile(
			join(root, 'build', '_prerendered', 'account.html'),
			'utf8'
		);

		expect(stored).toContain('account shell');
		expect(stored).toContain('greeting loading');
		expect(stored).toContain('hx-get="/fragments/greeting"');
		expect(stored).not.toContain('hello');
	});

	test('is served from that file, the same for every visitor, without its route running', async () => {
		const before = await runsNow();

		const ada = await fetch(url('/account'), {
			headers: { cookie: 'user=ada' }
		});
		const grace = await fetch(url('/account'), {
			headers: { cookie: 'user=grace' }
		});
		const html = await ada.text();

		expect(html).toContain('greeting loading');
		expect(await grace.text()).toBe(html);
		expect((await runsNow()).page).toBe(before.page);
	});

	test('has its fragment answered for each visitor by an ordinary route', async () => {
		const ada = await fetch(url('/fragments/greeting'), {
			headers: { cookie: 'user=ada' }
		});
		const grace = await fetch(url('/fragments/greeting'), {
			headers: { cookie: 'user=grace' }
		});

		expect(await ada.text()).toContain('hello ada');
		expect(await grace.text()).toContain('hello grace');
	});

	test('in a browser, shows the visitor’s fragment in place of the fallback', async () => {
		const errors: string[] = [];
		const session = await openPage(url('/ready'), {
			onPage: (page) => {
				page.on('pageerror', (error) => errors.push(error.message));
			}
		});
		try {
			const { page } = session;
			await page
				.context()
				.addCookies([{ name: 'user', url: url('/'), value: 'ada' }]);

			await page.goto(url('/account'), { waitUntil: 'domcontentloaded' });
			await page.waitForFunction(
				() =>
					document.getElementById('greeting')?.textContent ===
					'hello ada',
				undefined,
				{ timeout: 30_000 }
			);

			expect(await page.locator('#heading').textContent()).toBe(
				'account shell'
			);
			expect(errors).toEqual([]);
		} finally {
			await session.close();
		}
	}, 120_000);
});

describe('a pre-rendered page with `static.cache`', () => {
	test('may be kept by any cache, and is checked before each use', async () => {
		const response = await fetch(url('/account'));
		await response.body?.cancel();

		expect(response.headers.get('cache-control')).toBe('public, no-cache');
		expect(response.headers.get('etag')).toBeTruthy();
		expect(response.headers.get('vary')).toContain('Accept');
	});

	test('a copy that is current is confirmed in a 304', async () => {
		const first = await fetch(url('/account'));
		await first.body?.cancel();

		const again = await fetch(url('/account'), {
			headers: { 'if-none-match': first.headers.get('etag') ?? '' }
		});

		expect(again.status).toBe(304);
		expect(await again.text()).toBe('');
	});
});
