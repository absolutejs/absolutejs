import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
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
import { openPage } from '../../helpers/browser';

/* Partial prerendering in edge mode, under `absolute start`.
 *
 * `static.partial.edge` serves a partial page's shell on its own, for a
 * CDN to keep, and the page fetches its dynamic slots in a second
 * request. Checked two ways: over HTTP, for what a cache in front of the
 * server would see — and in a browser, because the second request is
 * made by a loader in the shell, and only a browser runs it.
 *
 * The CLI and the fixture's imports are this checkout's sources. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const CLI_ENTRY = join(repoRoot, 'src', 'cli', 'index.ts');
const fromSource = (path: string) =>
	join(repoRoot, 'src', path).replace(/\\/g, '/');
const PORT = 4634;

const CONFIG = `import { defineConfig } from '${fromSource('index.ts')}';

export default defineConfig({
	buildDirectory: './build',
	reactDirectory: './react',
	static: { partial: { edge: true }, routes: ['/account'] }
});
`;

const PAGE = `import { StreamSlot } from '${fromSource('react/components/index.ts')}';

export const Account = () => (
	<html lang="en">
		<head>
			<title>Account</title>
		</head>
		<body>
			<h1 id="heading">account shell</h1>
			<StreamSlot dynamic fallbackHtml="<p>greeting loading</p>" id="greeting" />
			<StreamSlot dynamic fallbackHtml="<p>slow loading</p>" id="slow" />
		</body>
	</html>
);
`;

const SERVER_TS = `import { Elysia } from 'elysia';
import { asset, defineHoles, networking, prepare } from '${fromSource('index.ts')}';
import { handleReactPageRequest } from '${fromSource('react/server.ts')}';
import { Account } from './react/pages/Account';

const { absolutejs, manifest } = await prepare();

const runs = { account: 0 };

const userFrom = (request: Request) =>
	request.headers.get('cookie')?.match(/user=(\\w+)/)?.[1] ?? 'guest';

defineHoles('/account', {
	greeting: ({ request }) => \`<p>hello \${userFrom(request)}</p>\`,
	slow: async ({ request }) => {
		await Bun.sleep(300);

		return \`<p>orders of \${userFrom(request)}</p>\`;
	}
});

export const server = new Elysia()
	.use(absolutejs)
	.get('/account', ({ request }) => {
		runs.account += 1;

		return handleReactPageRequest({
			collectStreamingSlots: true,
			index: asset(manifest, 'AccountIndex'),
			Page: Account,
			request
		});
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
	root = await mkdtemp(join(tmpdir(), 'absolute-partial-edge-'));
	await mkdir(join(root, 'react', 'pages'), { recursive: true });
	await writeFile(join(root, 'react', 'pages', 'Account.tsx'), PAGE);
	await writeFile(join(root, 'absolute.config.ts'), CONFIG);
	await writeFile(join(root, 'server.ts'), SERVER_TS);
	await writeFile(
		join(root, 'package.json'),
		JSON.stringify({ name: 'partial-edge-fixture', type: 'module' })
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

const runsNow = async () => {
	const response = await fetch(url('/runs'));
	const runs: { account: number } = await response.json();

	return runs.account;
};

const HOLES = '?__absolute_holes=1';

describe('a partial page in edge mode, as a cache in front of it sees it', () => {
	test('the shell is public, tagged, and the same for every visitor', async () => {
		const ada = await fetch(url('/account'), {
			headers: { accept: 'text/html', cookie: 'user=ada' }
		});
		const grace = await fetch(url('/account'), {
			headers: { accept: 'text/html', cookie: 'user=grace' }
		});
		const html = await ada.text();

		expect(ada.headers.get('x-absolute-partial-prerender')).toBe(
			'edge-shell'
		);
		expect(ada.headers.get('cache-control')).toBe('public, no-cache');
		expect(ada.headers.get('etag')).toBeTruthy();
		expect(html).toContain('account shell');
		expect(html).toContain('greeting loading');
		expect(html).not.toContain('hello');
		expect(await grace.text()).toBe(html);
		expect(grace.headers.get('etag')).toBe(ada.headers.get('etag'));
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

	test('the holes are the visitor’s own, uncacheable, and cost no route run', async () => {
		const before = await runsNow();

		const response = await fetch(url(`/account${HOLES}`), {
			headers: { cookie: 'user=ada' }
		});
		const lines = (await response.text())
			.split('\n')
			.filter(Boolean)
			.map((line) => JSON.parse(line) as unknown);

		expect(response.headers.get('cache-control')).toBe('private, no-store');
		expect(lines).toEqual([
			{ id: 'greeting', payload: '<p>hello ada</p>' },
			{ id: 'slow', payload: '<p>orders of ada</p>' }
		]);
		expect(await runsNow()).toBe(before);
	});
});

describe('a partial page in edge mode, in a browser', () => {
	test('fills its slots for the visitor, the quick one before the slow', async () => {
		const errors: string[] = [];
		const session = await openPage(url('/ready'), {
			onPage: (page) => {
				page.on('pageerror', (error) => errors.push(error.message));
				page.on('console', (message) => {
					if (message.type() === 'error') errors.push(message.text());
				});
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
			// The slow one is still to come: the holes are streamed,
			// not delivered together.
			const slowAtFirst = await page.locator('#slow').textContent();
			await page.waitForFunction(
				() =>
					document.getElementById('slow')?.textContent ===
					'orders of ada',
				undefined,
				{ timeout: 30_000 }
			);

			expect(slowAtFirst).toBe('slow loading');
			expect(await page.locator('#heading').textContent()).toBe(
				'account shell'
			);
			expect(errors).toEqual([]);
		} finally {
			await session.close();
		}
	}, 120_000);
});
