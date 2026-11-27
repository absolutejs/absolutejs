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
import type { Page } from 'playwright';
import { openPage } from '../../helpers/browser';

/* A file route's `metadata`, under `absolute start`.
 *
 * `export const metadata` in a route's server module, merged over the
 * `metadata` of the `layout.server` modules above it, is written into
 * the document's head by the framework — for a React page that writes
 * its own document, a Svelte page, and an HTML file alike. What is
 * asserted is the head a crawler would be sent, and, in a browser, that
 * putting tags there did not upset the page.
 *
 * The CLI and the framework are this checkout's sources: the fixture's
 * tsconfig points the package's names at `src/`. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const CLI_ENTRY = join(repoRoot, 'src', 'cli', 'index.ts');
const fromSource = (path: string) =>
	join(repoRoot, 'src', path).replace(/\\/g, '/');
const PORT = 4638;

/* A post. `ownHead` is a page that writes a title and a description of
 * its own, as one written before its route had metadata would. */
const postPage = (
	ownHead: boolean
) => `import { useEffect, useState } from 'react';
import { enableNavigation, navigateDocument } from '@absolutejs/absolute/client/navigation';

type Props = { edition: string; title: string };

export default function Post({ edition, title }: Props) {
	const [clicks, setClicks] = useState(0);
	useEffect(() => {
		enableNavigation();
		Reflect.set(window, '__go', navigateDocument);
		Reflect.set(window, '__hydrated', true);
	}, []);

	return (
		<html lang="en">
			<head>
				<meta charSet="utf-8" />${
					ownHead
						? `
				<title>Hand written</title>
				<meta content="written by hand" name="description" />`
						: ''
				}
				<meta content="width=device-width" name="viewport" />
			</head>
			<body>
				<h1 id="heading">{title}</h1>
				<p id="edition">{edition}</p>
				<button id="clicks" onClick={() => setClicks(clicks + 1)} type="button">
					{clicks}
				</button>
			</body>
		</html>
	);
}
`;

const POST_SERVER = `const TITLES: Record<string, string> = {
	draft: 'A draft',
	hello: 'Hello, world',
	risky: '</title><script>window.__injected = true</script>'
};

export const load = ({ params, query }: { params: { slug: string }; query: Record<string, string | undefined> }) => ({
	edition: query.edition ?? 'first',
	title: TITLES[params.slug] ?? params.slug
});

export const metadata = ({ data, params }: { data: { edition: string; title: string }; params: Record<string, string | undefined> }) => {
	if (params.slug === 'broken') throw new Error('metadata could not be worked out');

	return {
		canonical: \`https://acme.test/blog/\${params.slug}\`,
		description: \`\${data.title}, \${data.edition} edition\`,
		openGraph: { type: 'article' },
		...(params.slug === 'draft' ? { robots: { index: false } } : {}),
		title: data.title
	};
};
`;

const PLAIN_PAGE = (id: string) => `export default function Page() {
	return (
		<html lang="en">
			<head>
				<meta charSet="utf-8" />
			</head>
			<body>
				<main id="${id}">${id}</main>
			</body>
		</html>
	);
}
`;

const FILES: Record<string, string> = {
	'absolute.config.ts': `import { defineConfig } from '${fromSource('index.ts')}';

export default defineConfig({
	buildDirectory: './build',
	fileRoutes: { output: './routes.gen.ts' },
	htmlDirectory: './html',
	reactDirectory: './react',
	svelteDirectory: './svelte'
});
`,
	// An HTML file with a title of its own, and a route that sets one.
	'html/routes/help/faq.html':
		'<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Old FAQ</title></head><body><main id="faq">faq</main></body></html>\n',
	'html/routes/help/faq.server.ts':
		"export const metadata = { description: 'Common questions', title: 'FAQ' };\n",
	'package.json': JSON.stringify({
		name: 'route-metadata-fixture',
		type: 'module'
	}),
	'react/routes/about.server.ts':
		"export const metadata = { title: { absolute: 'About us' } };\n",
	'react/routes/about.tsx': PLAIN_PAGE('about'),
	'react/routes/blog/[slug].server.ts': POST_SERVER,
	'react/routes/blog/[slug].tsx': postPage(true),
	'react/routes/blog/index.tsx': PLAIN_PAGE('blog-index'),
	// A section: its own name, and how the titles under it are formed.
	'react/routes/blog/layout.server.ts':
		"export const metadata = { title: { default: 'Blog', template: '%s | Acme Blog' } };\n",
	// No server module of its own: everything comes from above.
	'react/routes/index.tsx': PLAIN_PAGE('home'),
	// The site: a title template, a default, and what every card says.
	'react/routes/layout.server.ts':
		"export const metadata = { openGraph: { siteName: 'Acme' }, title: { default: 'Acme', template: '%s | Acme' } };\n",
	// The same post, from a page that leaves its head to the route.
	'react/routes/notes/[slug].server.ts': POST_SERVER,
	'react/routes/notes/[slug].tsx': postPage(false),
	'react/routes/pricing.server.ts':
		"export const metadata = { title: 'Pricing' };\n",
	'react/routes/pricing.tsx': PLAIN_PAGE('pricing'),
	'server.ts': `import { Elysia } from 'elysia';
import { fileRoutes, networking, prepare } from '${fromSource('index.ts')}';
import { routeTree } from './routes.gen';

const { absolutejs, manifest } = await prepare();

export const server = new Elysia()
	.use(absolutejs)
	.use(fileRoutes(routeTree, manifest))
	.get('/ready', () => 'ready')
	.use(networking);
`,
	'svelte/routes/docs/[page].server.ts':
		"export const load = ({ params }: { params: { page: string } }) => ({ page: params.page });\n\nexport const metadata = ({ data }: { data: { page: string } }) => ({ description: 'Docs for ' + data.page, title: data.page + ' docs' });\n",
	'svelte/routes/docs/[page].svelte':
		'<script lang="ts">\n\tlet { page }: { page: string } = $props();\n</script>\n\n<svelte:head><title>Svelte wrote this</title></svelte:head>\n\n<main id="doc">{page}</main>\n',
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
				],
				'@absolutejs/absolute/svelte': [fromSource('svelte/index.ts')],
				'@absolutejs/absolute/svelte/server': [
					fromSource('svelte/server.ts')
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
	root = await mkdtemp(join(tmpdir(), 'absolute-route-metadata-'));
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

const headOf = async (path: string) => {
	const response = await fetch(url(path), {
		headers: { accept: 'text/html' }
	});
	const html = await response.text();

	return {
		head: /<head[^>]*>([\s\S]*?)<\/head>/i.exec(html)?.[1] ?? '',
		html,
		status: response.status
	};
};

const titlesIn = (head: string) =>
	[...head.matchAll(/<title[^>]*>([\s\S]*?)<\/title>/gi)].map(
		(match) => match[1]
	);

const contentOf = (head: string, attribute: string, value: string) =>
	[...head.matchAll(/<meta\b[^>]*>/gi)]
		.map((match) => match[0])
		.filter((tag) => tag.includes(`${attribute}="${value}"`))
		.map((tag) => /content="([^"]*)"/.exec(tag)?.[1]);

describe('a route’s title', () => {
	test('is formed by the template of the folders above it', async () => {
		expect(titlesIn((await headOf('/pricing')).head)).toEqual([
			'Pricing | Acme'
		]);
	});

	test('by the nearest template', async () => {
		expect(titlesIn((await headOf('/blog/hello')).head)).toEqual([
			'Hello, world | Acme Blog'
		]);
	});

	test('is the folder’s default for a route that sets none', async () => {
		expect(titlesIn((await headOf('/')).head)).toEqual(['Acme']);
		expect(titlesIn((await headOf('/blog')).head)).toEqual(['Blog']);
	});

	test('is exact when the route says so', async () => {
		expect(titlesIn((await headOf('/about')).head)).toEqual(['About us']);
	});
});

describe('a route’s metadata, in a page that writes its own head', () => {
	test('replaces the page’s title and description: one of each', async () => {
		const { head } = await headOf('/blog/hello');

		expect(titlesIn(head)).toHaveLength(1);
		expect(contentOf(head, 'name', 'description')).toEqual([
			'Hello, world, first edition'
		]);
		expect(head).not.toContain('Hand written');
		expect(head).not.toContain('written by hand');
	});

	test('leaves what the route says nothing about', async () => {
		const { head } = await headOf('/blog/hello');

		expect(contentOf(head, 'name', 'viewport')).toEqual([
			'width=device-width'
		]);
	});

	test('carries what the folders above set, with the route’s own on top', async () => {
		const { head } = await headOf('/blog/hello');

		expect(contentOf(head, 'property', 'og:site_name')).toEqual(['Acme']);
		expect(contentOf(head, 'property', 'og:type')).toEqual(['article']);
		// A card with no title of its own takes the page's.
		expect(contentOf(head, 'property', 'og:title')).toEqual([
			'Hello, world | Acme Blog'
		]);
		expect(head).toContain(
			'<link rel="canonical" href="https://acme.test/blog/hello"'
		);
	});

	test('can depend on the request: a draft is not indexed', async () => {
		expect(
			contentOf((await headOf('/blog/draft')).head, 'name', 'robots')
		).toEqual(['noindex']);
		expect(
			contentOf((await headOf('/blog/hello')).head, 'name', 'robots')
		).toEqual([]);
	});

	/* A post's title is not written by the developer. */
	test('is escaped', async () => {
		const { html } = await headOf('/blog/risky');

		expect(html).not.toContain('<script>window.__injected');
		expect(html).toContain('&lt;script&gt;window.__injected');
	});

	test('that cannot be worked out costs the page its metadata, not the page', async () => {
		const { head, html, status } = await headOf('/blog/broken');

		expect(status).toBe(200);
		expect(html).toContain('id="heading"');
		// The page's own head is what is left.
		expect(titlesIn(head)).toEqual(['Hand written']);
	});
});

describe('a route’s metadata, in the other kinds of page', () => {
	test('a Svelte page', async () => {
		const { head, html } = await headOf('/docs/routing');

		expect(html).toContain('id="doc"');
		expect(titlesIn(head)).toEqual(['routing docs']);
		expect(contentOf(head, 'name', 'description')).toEqual([
			'Docs for routing'
		]);
	});

	test('an HTML file', async () => {
		const { head, html } = await headOf('/help/faq');

		expect(html).toContain('id="faq"');
		expect(titlesIn(head)).toEqual(['FAQ']);
		expect(contentOf(head, 'name', 'description')).toEqual([
			'Common questions'
		]);
	});
});

describe('a request for a page’s data', () => {
	test('is given the route’s title and tags with the data', async () => {
		const response = await fetch(url('/blog/hello?edition=second'), {
			headers: { accept: 'application/vnd.absolute.route+json' }
		});
		const envelope: {
			head?: { tags?: string; title?: string };
			props?: Record<string, unknown>;
		} = await response.json();

		expect(envelope.props).toMatchObject({ edition: 'second' });
		expect(envelope.head?.title).toBe('Hello, world | Acme Blog');
		expect(envelope.head?.tags).toContain(
			'content="Hello, world, second edition"'
		);
	});
});

type Watched = { problems: string[] };

const watch = (watched: Watched) => (page: Page) => {
	page.on('pageerror', (error) => watched.problems.push(error.message));
	page.on('console', (message) => {
		if (message.type() === 'error' || message.type() === 'warning')
			watched.problems.push(message.text());
	});
};

const hydrated = (tab: Page) =>
	tab.waitForFunction(
		() => Reflect.get(window, '__hydrated') === true,
		undefined,
		{ timeout: 30_000 }
	);

describe('a route’s metadata, in a browser', () => {
	test('is the page’s title, hydration is clean, and it follows a navigation in place', async () => {
		const watched: Watched = { problems: [] };
		const session = await openPage(url('/notes/hello'), {
			onPage: watch(watched),
			waitUntil: 'load'
		});
		try {
			const { page: tab } = session;
			await hydrated(tab);

			expect(await tab.title()).toBe('Hello, world | Acme');
			// The page still works: it was hydrated, not replaced.
			await tab.click('#clicks');
			expect(await tab.locator('#clicks').textContent()).toBe('1');

			// The same page, another query: handed its data in place.
			const outcome = await tab.evaluate(() => {
				const navigate: unknown = Reflect.get(window, '__go');

				return typeof navigate === 'function'
					? (Reflect.apply(navigate, undefined, [
							'/notes/hello?edition=second'
						]) as unknown)
					: undefined;
			});
			await tab.waitForFunction(
				() =>
					document.getElementById('edition')?.textContent ===
					'second',
				undefined,
				{ timeout: 30_000 }
			);

			expect(outcome).toBe('updated');
			// Its state was kept, and its head was brought up to date.
			expect(await tab.locator('#clicks').textContent()).toBe('1');
			expect(
				await tab.evaluate(() =>
					Array.from(
						document.querySelectorAll('meta[name="description"]')
					).map((tag) => tag.getAttribute('content'))
				)
			).toEqual(['Hello, world, second edition']);
			expect(await tab.title()).toBe('Hello, world | Acme');
			expect(
				await tab.evaluate(
					() => document.querySelectorAll('title').length
				)
			).toBe(1);
			expect(watched.problems).toEqual([]);
		} finally {
			await session.close();
		}
	}, 120_000);

	/* The limit of what the server can do. The document arrives with
	 * the route's title, and a React page that renders a <title> takes
	 * over the document's first one as it hydrates and writes its own
	 * text into it. Pinned so it is known, not found: the fix is to
	 * delete the tag from the page, which the build says by name. */
	test('a page that still renders its own title puts it back once it hydrates', async () => {
		const watched: Watched = { problems: [] };
		const session = await openPage(url('/blog/hello'), {
			onPage: watch(watched),
			waitUntil: 'load'
		});
		try {
			const { page: tab } = session;
			await hydrated(tab);

			expect(await tab.title()).toBe('Hand written');
		} finally {
			await session.close();
		}
	}, 120_000);
});
