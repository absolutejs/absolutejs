import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
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

/* A pre-rendered page asked for its DATA, under `absolute start`.
 *
 * Every page handler answers `Accept: application/vnd.absolute.route+json`
 * with the page's props as JSON — what a `<Link>` prefetches and what
 * `invalidate()` refreshes from. For a pre-rendered route that request
 * never reached the handler: the pre-render layer answered it with the
 * cached HTML file, because it did not look at what was asked for.
 *
 * The page here shows a number the server holds, so the answers can be
 * told apart: the file says what the build rendered, and the data says
 * what the route would render now.
 *
 * The CLI and the fixture's imports are this checkout's sources. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const CLI_ENTRY = join(repoRoot, 'src', 'cli', 'index.ts');
const fromSource = (path: string) =>
	join(repoRoot, 'src', path).replace(/\\/g, '/');
const PORT = 4620;
const ROUTE_DATA = 'application/vnd.absolute.route+json';

const CONFIG = `import { defineConfig } from '${fromSource('index.ts')}';

export default defineConfig({
	buildDirectory: './build',
	reactDirectory: './react',
	static: { routes: ['/count'] }
});
`;

const PAGE = `type CountProps = { count: number };

export const Count = ({ count }: CountProps) => (
	<html lang="en">
		<head>
			<title>Count</title>
		</head>
		<body>
			<p id="count">count:{count}</p>
		</body>
	</html>
);
`;

const SERVER_TS = `import { Elysia } from 'elysia';
import { asset, networking, prepare } from '${fromSource('index.ts')}';
import { handleReactPageRequest } from '${fromSource('react/server.ts')}';
import { Count } from './react/pages/Count';

const { absolutejs, manifest } = await prepare();

let count = 0;

export const server = new Elysia()
	.use(absolutejs)
	.get('/count', ({ request }) =>
		handleReactPageRequest({
			index: asset(manifest, 'CountIndex'),
			Page: Count,
			props: { count },
			request
		})
	)
	.get('/ready', () => 'ready')
	.post('/bump', () => {
		count += 1;

		return { count };
	})
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
	root = await mkdtemp(join(tmpdir(), 'absolute-prerender-route-data-'));
	await mkdir(join(root, 'react', 'pages'), { recursive: true });
	await writeFile(join(root, 'react', 'pages', 'Count.tsx'), PAGE);
	await writeFile(join(root, 'absolute.config.ts'), CONFIG);
	await writeFile(join(root, 'server.ts'), SERVER_TS);
	await writeFile(
		join(root, 'package.json'),
		JSON.stringify({ name: 'prerender-route-data-fixture', type: 'module' })
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
	await fetch(url('/bump'), { method: 'POST' });
}, 600_000);

afterAll(async () => {
	server?.kill();
	await server?.exited;
	if (root) await rm(root, { force: true, recursive: true });
});

describe('a pre-rendered page asked for its data', () => {
	test('is pre-rendered, and a browser is served the file', async () => {
		expect(
			existsSync(join(root, 'build', '_prerendered', 'count.html'))
		).toBe(true);
		const response = await fetch(url('/count'), {
			headers: { accept: 'text/html' }
		});

		// The build's copy: the counter has moved on since.
		expect(await response.text()).toContain('count:<!-- -->0');
		/* And sent as it always was, with nothing for a cache to act
		 * on: `static.cache` is asked for, not assumed
		 * (prerender-cache-htmx.test.ts has it on). */
		expect(response.headers.get('etag')).toBeNull();
		expect(response.headers.get('cache-control')).toBeNull();
	});

	/* Was the same HTML file, whatever was asked for. */
	test('answers a data request with data, from the route as it is now', async () => {
		const response = await fetch(url('/count'), {
			headers: { accept: ROUTE_DATA }
		});

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toContain(ROUTE_DATA);
		expect(await response.json()).toMatchObject({
			kind: 'route',
			props: { count: 1 }
		});
	});

	test('still serves the file to a request that merely accepts JSON', async () => {
		const response = await fetch(url('/count'), {
			headers: { accept: 'application/json, text/html' }
		});

		expect(response.headers.get('content-type')).toContain('text/html');
	});
});
