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

/* Route-level holes under `absolute start`.
 *
 * A partially pre-rendered page is a cached shell plus dynamic slots
 * filled per request. Filling them used to mean running the route and
 * rendering the page again to reach the slots' resolvers. A route that
 * declares its holes with `defineHoles` is not run at all: the server
 * calls the resolvers with the visitor's request and streams the result
 * into the shell.
 *
 * Each route here counts how often its handler runs, which is the thing
 * being claimed. `/declared` declares every hole; `/partly` leaves one
 * to the page, and is the route that still has to run.
 *
 * The CLI and the fixture's imports are this checkout's sources. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const CLI_ENTRY = join(repoRoot, 'src', 'cli', 'index.ts');
const fromSource = (path: string) =>
	join(repoRoot, 'src', path).replace(/\\/g, '/');
const PORT = 4633;

const CONFIG = `import { defineConfig } from '${fromSource('index.ts')}';

export default defineConfig({
	buildDirectory: './build',
	reactDirectory: './react',
	static: { routes: ['/declared', '/partly', '/posts/first'] }
});
`;

const PAGE = `import { StreamSlot } from '${fromSource('react/components/index.ts')}';

type Props = { title: string; ownResolver?: boolean };

export const Holes = ({ ownResolver, title }: Props) => (
	<html lang="en">
		<head>
			<title>{title}</title>
		</head>
		<body>
			<h1>{title} shell</h1>
			<StreamSlot dynamic fallbackHtml="<p>greeting loading</p>" id="greeting" />
			<StreamSlot dynamic fallbackHtml="<p>badge loading</p>" id="badge" />
			{ownResolver ? (
				<StreamSlot
					dynamic
					fallbackHtml="<p>own loading</p>"
					id="own"
					resolve={() => '<p>resolved by the page</p>'}
				/>
			) : null}
		</body>
	</html>
);
`;

const BADGE = `export const Badge = ({ label }: { label: string }) => (
	<span className="badge">{label}</span>
);
`;

const SERVER_TS = `import { Elysia } from 'elysia';
import {
	asset,
	cookies,
	defineHoles,
	holeComponent,
	networking,
	prepare
} from '${fromSource('index.ts')}';
import { handleReactPageRequest } from '${fromSource('react/server.ts')}';
import { Badge } from './react/components/Badge';
import { Holes } from './react/pages/Holes';

const { absolutejs, manifest } = await prepare();

const runs: Record<string, number> = { declared: 0, partly: 0, posts: 0 };

const userFrom = (request: Request) =>
	request.headers.get('cookie')?.match(/user=(\\w+)/)?.[1] ?? 'guest';

const holes = {
	// Through the request it is handed, and through the helper that
	// reads the request in context: both must be the visitor's.
	badge: () => holeComponent.react(Badge, { label: cookies().get('user') ?? 'none' }),
	greeting: ({ request }: { request: Request }) =>
		\`<p>hello \${userFrom(request)}</p>\`
};

defineHoles('/declared', holes);
defineHoles('/partly', holes);
defineHoles('/posts/:slug', {
	badge: ({ params }) => \`<p>badge for \${params.slug}</p>\`,
	greeting: ({ params, request }) =>
		\`<p>\${userFrom(request)} reads \${params.slug}</p>\`
});

const page = (name: string, props: { title: string; ownResolver?: boolean }) =>
	({ request }: { request: Request }) => {
		runs[name] = (runs[name] ?? 0) + 1;

		return handleReactPageRequest({
			collectStreamingSlots: true,
			index: asset(manifest, 'HolesIndex'),
			Page: Holes,
			props,
			request
		});
	};

export const server = new Elysia()
	.use(absolutejs)
	.get('/declared', page('declared', { title: 'declared' }))
	.get('/partly', page('partly', { ownResolver: true, title: 'partly' }))
	.get('/posts/:slug', page('posts', { title: 'post' }))
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
	root = await mkdtemp(join(tmpdir(), 'absolute-route-holes-'));
	await mkdir(join(root, 'react', 'pages'), { recursive: true });
	await mkdir(join(root, 'react', 'components'), { recursive: true });
	await writeFile(join(root, 'react', 'pages', 'Holes.tsx'), PAGE);
	await writeFile(join(root, 'react', 'components', 'Badge.tsx'), BADGE);
	await writeFile(join(root, 'absolute.config.ts'), CONFIG);
	await writeFile(join(root, 'server.ts'), SERVER_TS);
	await writeFile(
		join(root, 'package.json'),
		JSON.stringify({ name: 'route-holes-fixture', type: 'module' })
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
	const runs: Record<string, number> = await response.json();

	return runs;
};

/* The page as a reader would see it: a hole arrives as a script that
 * patches it in, with its markup escaped for the script, and React
 * separates adjacent text with empty comments. */
const readable = (html: string) =>
	html
		.replace(/\\u003C/g, '<')
		.replace(/\\"/g, '"')
		.replace(/<!-- -->/g, '');

const pageAs = async (path: string, user: string) => {
	const response = await fetch(url(path), {
		headers: { accept: 'text/html', cookie: `user=${user}` }
	});

	return { html: readable(await response.text()), response };
};

describe('a pre-rendered page whose route declares its holes', () => {
	test('was captured as a shell, with its slots left as holes', async () => {
		const prerendered = join(root, 'build', '_prerendered');

		expect(existsSync(join(prerendered, 'declared.html'))).toBe(true);
		expect(existsSync(join(prerendered, 'declared.holes'))).toBe(true);
	});

	test('is filled for each visitor without the route running', async () => {
		const before = await runsNow();

		const ada = await pageAs('/declared', 'ada');
		const grace = await pageAs('/declared', 'grace');

		expect(ada.response.headers.get('x-absolute-partial-prerender')).toBe(
			'shell'
		);
		expect(ada.html).toContain('declared shell');
		expect(ada.html).toContain('hello ada');
		expect(ada.html).toContain('<span class="badge">ada</span>');
		expect(grace.html).toContain('hello grace');
		expect(grace.html).toContain('<span class="badge">grace</span>');
		expect(grace.html).not.toContain('ada');
		// Two visitors served; the handler has not run since the build.
		expect((await runsNow()).declared).toBe(before.declared ?? 0);
	});

	test('reaches its holes with the route’s params', async () => {
		const before = await runsNow();

		const { html } = await pageAs('/posts/first', 'ada');

		expect(html).toContain('ada reads first');
		expect(html).toContain('badge for first');
		expect((await runsNow()).posts).toBe(before.posts ?? 0);
	});
});

describe('a route that leaves one hole to its page', () => {
	test('is run for each request, and every slot is still filled', async () => {
		const before = await runsNow();

		const { html } = await pageAs('/partly', 'ada');

		expect(html).toContain('hello ada');
		expect(html).toContain('<span class="badge">ada</span>');
		expect(html).toContain('resolved by the page');
		expect((await runsNow()).partly).toBe((before.partly ?? 0) + 1);
	});
});

describe('a route that is not pre-rendered', () => {
	/* The page is rendered, and its slots show what the route's holes
	 * say: one definition of what a slot shows, wherever it is filled. */
	test('fills the same slots from the same holes', async () => {
		const { html, response } = await pageAs('/posts/second', 'ada');

		expect(response.headers.get('x-absolute-partial-prerender')).toBeNull();
		expect(html).toContain('ada reads second');
		expect(html).toContain('badge for second');
	});
});
