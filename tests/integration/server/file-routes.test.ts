import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ensureDistBuild } from '../../helpers/ensureDistBuild';
import {
	linkNodeModules,
	writeFileRoutesFixture
} from '../../helpers/fileRoutesFixture';

/* File routes (docs/FILE_ROUTER_PLAN.md, Phase 1): React and Svelte route
 * files with typed `load` modules, served by `absolute start` and
 * `absolute dev` from the route module the build generates, and a route
 * file added while `absolute dev` runs answers without a restart. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const CLI_ENTRY = join(repoRoot, 'dist', 'cli', 'index.js');
const PROD_PORT = 4522;
const DEV_PORT = 4523;
const READY_ATTEMPTS = 240;
const READY_INTERVAL_MS = 250;

type Page = { body: string; location: string | null; status: number };

const get = async (port: number, path: string) => {
	const response = await fetch(`http://localhost:${port}${path}`, {
		redirect: 'manual'
	});
	const page: Page = {
		body: await response.text(),
		location: response.headers.get('location'),
		status: response.status
	};

	return page;
};

const waitFor = async (check: () => Promise<boolean>, label: string) => {
	for (let attempt = 0; attempt < READY_ATTEMPTS; attempt++) {
		if (await check().catch(() => false)) return;
		await Bun.sleep(READY_INTERVAL_MS);
	}
	throw new Error(`timed out waiting for ${label}`);
};

const spawnCli = (root: string, args: string[], env: Record<string, string>) =>
	Bun.spawn(['bun', CLI_ENTRY, ...args], {
		cwd: root,
		env: { ...process.env, FORCE_COLOR: '0', TELEMETRY_OFF: '1', ...env },
		stderr: 'pipe',
		stdout: 'pipe'
	});

const createApp = async () => {
	const root = await mkdtemp(join(tmpdir(), 'absolute-file-routes-'));
	await writeFileRoutesFixture(root);
	await linkNodeModules(root);

	return root;
};

const expectRoutes = async (port: number) => {
	const home = await get(port, '/');
	const post = await get(port, '/blog/hello-world?view=compact');
	const secret = await get(port, '/blog/secret');
	const docs = await get(port, '/docs');
	const topic = await get(port, '/docs/routing');

	expect(home.status).toBe(200);
	expect(home.body).toContain('FILE_HOME');
	expect(post.status).toBe(200);
	expect(post.body).toContain('<h1 id="title">POST_HELLO-WORLD</h1>');
	expect(post.body).toContain('<p id="view">compact</p>');
	// The page's props reach the client for hydration, with its index.
	expect(post.body).toContain('"title":"POST_HELLO-WORLD"');
	expect(post.body).toMatch(/RouteBlogSlug[0-9a-z]{6}/);
	expect(secret.status).toBe(302);
	expect(secret.location).toBe('/');
	expect((await get(port, '/blog')).body).toContain('FILE_BLOG_INDEX');
	expect(docs.body).toContain('SVELTE_DOCS_INDEX');
	expect(topic.body).toContain('<h1 id="topic">TOPIC_routing</h1>');
	expect(topic.body).toContain('SVELTE_CHILD');
	expect(topic.body).toMatch(/RouteDocsTopic[0-9a-z]{6}/);
	/* A (group) folder names no path segment. */
	expect((await get(port, '/pricing')).body).toContain('FILE_PRICING');
	expect((await get(port, '/marketing/pricing')).status).toBe(404);

	/* An [[optional]] segment serves both paths, and `load` runs on each —
	 * the shorter path carries no params at all, which is where a
	 * required-params check would have skipped it and rendered the page
	 * with nothing. */
	const guide = await get(port, '/guide');
	const frGuide = await get(port, '/fr/guide');
	expect(guide.status).toBe(200);
	expect(guide.body).toContain('<p id="lang">none</p>');
	expect(frGuide.status).toBe(200);
	expect(frGuide.body).toContain('<p id="lang">fr</p>');
	expect(frGuide.body).toContain('<p id="guide">FILE_GUIDE</p>');
	// One page serving both: the same manifest entry, so the same index.
	const indexOf = (body: string) =>
		/RouteLangGuide[0-9a-z]{6}/.exec(body)?.[0];
	expect(indexOf(guide.body)).toBeDefined();
	expect(indexOf(frGuide.body)).toBe(indexOf(guide.body));

	/* A [...catchAll] matches the rest of the path and reads it under the
	 * name the file gave it, not Elysia's `*`. */
	const deep = await get(port, '/docs/a/b/c');
	expect(deep.status).toBe(200);
	expect(deep.body).toContain('CATCH_a/b/c');
	// The static sibling still wins over it.
	expect(topic.body).toContain('<h1 id="topic">TOPIC_routing</h1>');

	/* A Vue route: its `load` props render, and the private sibling it
	 * imports compiles with it — which is the part that would break if a
	 * Vue route were flattened out of the mirrored generated tree. */
	const item = await get(port, '/shop/widget');
	expect(item.status).toBe(200);
	expect(item.body).toContain('ITEM_widget');
	expect(item.body).toContain('VUE_CHILD');
	expect(item.body).toMatch(/RouteShopItem[0-9a-z]{6}/);
	/* The private sibling has no route of its own: `/shop/_Tag` is served
	 * by the `[item]` route with `_Tag` as the param, which is also why
	 * this cannot be asserted as a 404 the way `/_parts/Shell` is — there
	 * is a param route at that depth to catch it. */
	expect((await get(port, '/shop/_Tag')).body).toContain('ITEM__Tag');

	/* HTML and HTMX routes: the file the build produced, served as-is. The
	 * `<abs-include>` is the assertion that matters — it resolves against
	 * the page's source location, so it only expands if the route's output
	 * tree kept its source folder. */
	const handbook = await get(port, '/handbook');
	expect(handbook.status).toBe(200);
	expect(handbook.body).toContain('HTML_ROUTE_HANDBOOK');
	expect(handbook.body).toContain('HTML_BANNER');
	expect(handbook.body).not.toContain('abs-include');
	// A page in `pages/` is untouched by any of this.
	expect((await get(port, '/panel')).body).toContain('HTMX_ROUTE_PANEL');

	/* An Angular route. `load` returns the page's request context rather
	 * than props, so `NO_CONTEXT` in the body would mean the route served
	 * but the context never reached the component — the failure this
	 * assertion exists for. */
	const report = await get(port, '/reports/q3');
	expect(report.status).toBe(200);
	expect(report.body).toContain('PERIOD_q3');
	expect(report.body).not.toContain('NO_CONTEXT');

	// Explicit routes win, registered before or after fileRoutes().
	expect((await get(port, '/about')).body).toBe('EXPLICIT_ABOUT');
	expect((await get(port, '/explicit-first')).body).toBe('EXPLICIT_FIRST');
	// Private (`_`) files are not routes.
	expect((await get(port, '/_parts/Shell')).status).toBe(404);
	expect((await get(port, '/missing')).status).toBe(404);
};

describe('file routes in production', () => {
	let root = '';
	let server: ReturnType<typeof spawnCli> | undefined;

	beforeAll(async () => {
		await ensureDistBuild();
		root = await createApp();
		server = spawnCli(
			root,
			['start', 'server.ts', '--outdir', 'start-build'],
			{ NODE_ENV: 'production', PORT: String(PROD_PORT) }
		);
		await waitFor(
			async () => (await get(PROD_PORT, '/')).status === 200,
			'the production server'
		);
	}, 600_000);

	afterAll(async () => {
		server?.kill();
		await server?.exited;
		if (root) await rm(root, { force: true, recursive: true });
	});

	test('serves React and Svelte file routes with their load props', async () => {
		await expectRoutes(PROD_PORT);
	});

	test('serves the route pages client bundles', async () => {
		const post = await get(PROD_PORT, '/blog/hello-world');
		/* Matched by page name rather than by directory. Which directory a
		 * React index is served from depends on configuration unrelated to
		 * routing — adding an `htmlDirectory` moves it from
		 * `/react/indexes/` to `/.absolutejs/generated/react/indexes/`,
		 * which is a separate defect (an unbundled index shipped to the
		 * browser) and not something this test should assert either way.
		 * What it is for is that the index the page points at is REACHABLE,
		 * which the status check below is. */
		const script = /src="(\/[^"]*RouteBlogSlug[^"]+\.js)"/.exec(
			post.body
		)?.[1];
		const topic = await get(PROD_PORT, '/docs/routing');
		const svelteIndex = /import\("(\/[^"]*RouteDocsTopic[^"]+\.js)"\)/.exec(
			topic.body
		)?.[1];

		/* Angular route pages hydrate through a bare `import(...)` call
		 * rather than a `src=` script, and the index is named after the
		 * route — which is what the compiler rename exists for. */
		const report = await get(PROD_PORT, '/reports/q3');
		const angularIndex =
			/import\("(\/[^"]*RouteReportsPeriod[^"]+\.js)"\)/.exec(
				report.body
			)?.[1];

		expect(script).toBeDefined();
		expect(svelteIndex).toBeDefined();
		expect(angularIndex).toBeDefined();
		expect((await get(PROD_PORT, angularIndex ?? '/missing')).status).toBe(
			200
		);
		expect((await get(PROD_PORT, script ?? '/missing')).status).toBe(200);
		expect((await get(PROD_PORT, svelteIndex ?? '/missing')).status).toBe(
			200
		);
	});
});

describe('file routes in absolute dev', () => {
	let root = '';
	let server: ReturnType<typeof spawnCli> | undefined;

	beforeAll(async () => {
		await ensureDistBuild();
		root = await createApp();
		server = spawnCli(root, ['dev', 'server.ts'], {
			ABSOLUTE_PORT: String(DEV_PORT),
			ABSOLUTE_STRICT_PORT: '1',
			NODE_ENV: 'development'
		});
		await waitFor(
			async () => (await get(DEV_PORT, '/')).status === 200,
			'the dev server'
		);
	}, 600_000);

	afterAll(async () => {
		server?.kill();
		await server?.exited;
		if (root) await rm(root, { force: true, recursive: true });
	}, 30_000);

	test('serves React and Svelte file routes with their load props', async () => {
		await expectRoutes(DEV_PORT);
	}, 60_000);

	test('a route file added while dev runs answers without a restart', async () => {
		await writeFile(
			join(root, 'react', 'routes', 'blog', 'latest.tsx'),
			`export default function Latest() {
	return (
		<html lang="en">
			<head>
				<title>Latest</title>
			</head>
			<body>
				<p>NEW_REACT_ROUTE</p>
			</body>
		</html>
	);
}
`
		);
		await writeFile(
			join(root, 'svelte', 'routes', 'fresh.svelte'),
			'<p>NEW_SVELTE_ROUTE</p>\n'
		);
		await waitFor(
			async () =>
				(await get(DEV_PORT, '/blog/latest')).body.includes(
					'NEW_REACT_ROUTE'
				),
			'the added React route'
		);
		await waitFor(
			async () =>
				(await get(DEV_PORT, '/fresh')).body.includes(
					'NEW_SVELTE_ROUTE'
				),
			'the added Svelte route'
		);
		// The static route wins over /blog/:slug for its own path only.
		expect((await get(DEV_PORT, '/blog/other')).body).toContain(
			'POST_OTHER'
		);
	}, 90_000);

	test('a removed route file stops answering', async () => {
		await rm(join(root, 'svelte', 'routes', 'fresh.svelte'));
		await waitFor(
			async () => (await get(DEV_PORT, '/fresh')).status === 404,
			'the removed route to 404'
		);
	}, 90_000);

	test('a load edit applies to the next request', async () => {
		const serverModule = join(
			root,
			'react',
			'routes',
			'blog',
			'[slug].server.ts'
		);
		const source = await Bun.file(serverModule).text();
		await writeFile(serverModule, source.replace('POST_', 'ARTICLE_'));
		await waitFor(
			async () =>
				(await get(DEV_PORT, '/blog/edit')).body.includes(
					'ARTICLE_EDIT'
				),
			'the edited load function'
		);
	}, 90_000);
});
