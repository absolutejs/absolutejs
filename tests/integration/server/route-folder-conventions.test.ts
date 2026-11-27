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

/* `error` and `not-found` files in a route folder, under `absolute start`.
 *
 * `routes/blog/error.tsx` is the error page for the routes under
 * `routes/blog/`, and `routes/blog/not-found.tsx` their 404 — the
 * nearest one above a route, then the app's in `pages/`. Each page here
 * says which file it is, so every assertion is "this request was
 * answered by that file".
 *
 * The CLI and the framework are this checkout's sources: the fixture's
 * tsconfig points the package's names at `src/`, which the generated
 * route module imports by name. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const CLI_ENTRY = join(repoRoot, 'src', 'cli', 'index.ts');
const fromSource = (path: string) =>
	join(repoRoot, 'src', path).replace(/\\/g, '/');
const PORT = 4636;

const document = (id: string, body: string) => `<html lang="en">
			<head>
				<title>${id}</title>
			</head>
			<body>
				<main id="${id}">${body}</main>
			</body>
		</html>`;

const errorPage = (
	id: string
) => `export default function ErrorPage({ name }: { name: string }) {
	return (
		${document(id, '{name}')}
	);
}
`;

const notFoundPage = (id: string) => `export default function NotFoundPage() {
	return (
		${document(id, 'nothing here')}
	);
}
`;

const page = (
	id: string
) => `export default function Page({ explode }: { explode?: boolean }) {
	if (explode) throw new Error('the page could not be rendered');

	return (
		${document(id, 'ok')}
	);
}
`;

const STATIC_PAGE = (id: string) =>
	`<!doctype html><html lang="en"><head><title>${id}</title></head><body><main id="${id}">${id}</main></body></html>\n`;

/* Every route fails the same three ways, by what it is asked for. */
const SERVER_MODULE = `import { NotFound } from 'elysia';

const failing = (what: string | undefined) => {
	if (what === 'missing') throw new NotFound();
	if (what === 'broken') throw new Error('the data could not be loaded');

	return { explode: what === 'unrenderable' };
};

export const load = ({ params, query }: { params: Record<string, string | undefined>; query: Record<string, string | undefined> }) =>
	failing(params.slug ?? query.fail);
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
	// An HTML route folder: files used as written.
	'html/routes/help/faq.html': STATIC_PAGE('faq'),
	'html/routes/help/not-found.html': STATIC_PAGE('help-not-found'),
	'package.json': JSON.stringify({
		name: 'route-folder-conventions-fixture',
		type: 'module'
	}),
	// The app's own, for whatever no route folder covers.
	'react/pages/error.tsx': errorPage('app-error'),
	'react/pages/not-found.tsx': notFoundPage('app-not-found'),
	// A group: no segment in the address, and its own error page.
	'react/routes/(admin)/error.tsx': errorPage('admin-error'),
	'react/routes/(admin)/panel.server.ts': SERVER_MODULE,
	'react/routes/(admin)/panel.tsx': page('panel'),
	'react/routes/blog/[slug].server.ts': SERVER_MODULE,
	'react/routes/blog/[slug].tsx': page('post'),
	// Deeper than `blog/`, with an error page and no not-found.
	'react/routes/blog/drafts/error.tsx': errorPage('drafts-error'),
	'react/routes/blog/drafts/list.server.ts': SERVER_MODULE,
	'react/routes/blog/drafts/list.tsx': page('drafts'),
	'react/routes/blog/error.tsx': errorPage('blog-error'),
	'react/routes/blog/not-found.tsx': notFoundPage('blog-not-found'),
	'react/routes/index.tsx': page('home'),
	// No conventions anywhere above it but the app's.
	'react/routes/shop/item.server.ts': SERVER_MODULE,
	'react/routes/shop/item.tsx': page('item'),
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
	// A Svelte route folder, with both.
	'svelte/routes/docs/[slug].server.ts': SERVER_MODULE,
	'svelte/routes/docs/[slug].svelte': '<main id="doc">ok</main>\n',
	'svelte/routes/docs/error.svelte':
		'<script lang="ts">\n\tlet { name }: { name: string } = $props();\n</script>\n\n<main id="docs-error">{name}</main>\n',
	'svelte/routes/docs/not-found.svelte':
		'<main id="docs-not-found">nothing here</main>\n',
	'tsconfig.json': JSON.stringify({
		compilerOptions: {
			jsx: 'react-jsx',
			paths: {
				'@absolutejs/absolute': [fromSource('index.ts')],
				'@absolutejs/absolute/client': [fromSource('client/index.ts')],
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
	root = await mkdtemp(join(tmpdir(), 'absolute-route-folder-conventions-'));
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

type Answer = { html: string; status: number };

const ask = async (path: string, accept = 'text/html') => {
	const response = await fetch(url(path), { headers: { accept } });
	const answer: Answer = {
		html: await response.text(),
		status: response.status
	};

	return answer;
};

const shows = (answer: Answer, id: string) =>
	answer.html.includes(`id="${id}"`);

describe('a route whose load throws', () => {
	test('is answered by the error page of its own folder', async () => {
		const answer = await ask('/blog/broken');

		expect(answer.status).toBe(500);
		expect(shows(answer, 'blog-error')).toBe(true);
	});

	test('by the nearest one above it, not the first', async () => {
		const answer = await ask('/blog/drafts/list?fail=broken');

		expect(shows(answer, 'drafts-error')).toBe(true);
		expect(shows(answer, 'blog-error')).toBe(false);
	});

	test('by a (group) folder’s, which adds nothing to its address', async () => {
		const answer = await ask('/panel?fail=broken');

		expect(answer.status).toBe(500);
		expect(shows(answer, 'admin-error')).toBe(true);
	});

	test('by the app’s, when no folder above it has one', async () => {
		const answer = await ask('/shop/item?fail=broken');

		expect(answer.status).toBe(500);
		expect(shows(answer, 'app-error')).toBe(true);
	});

	test('and never says what went wrong outside development', async () => {
		const answer = await ask('/blog/broken');

		expect(answer.html).not.toContain('could not be loaded');
	});
});

describe('a route whose page throws while rendering', () => {
	test('is answered by the error page of its own folder', async () => {
		const answer = await ask('/blog/unrenderable');

		expect(answer.status).toBe(500);
		expect(shows(answer, 'blog-error')).toBe(true);
	});

	test('by the app’s, when no folder above it has one', async () => {
		const answer = await ask('/shop/item?fail=unrenderable');

		expect(shows(answer, 'app-error')).toBe(true);
	});
});

describe('a route whose load throws NotFound', () => {
	test('is answered by the not-found of its own folder', async () => {
		const answer = await ask('/blog/missing');

		expect(answer.status).toBe(404);
		expect(shows(answer, 'blog-not-found')).toBe(true);
	});

	/* `drafts/` has an error page and no not-found: each is looked for
	 * on its own, so this one is `blog/`'s. */
	test('by the nearest above it, each kind found on its own', async () => {
		const answer = await ask('/blog/drafts/list?fail=missing');

		expect(answer.status).toBe(404);
		expect(shows(answer, 'blog-not-found')).toBe(true);
	});

	test('by the app’s, when no folder above it has one', async () => {
		const answer = await ask('/shop/item?fail=missing');

		expect(answer.status).toBe(404);
		expect(shows(answer, 'app-not-found')).toBe(true);
	});

	test('a client asking for JSON is not sent a page', async () => {
		const answer = await ask('/blog/missing', 'application/json');

		expect(answer.status).toBe(404);
		expect(answer.html).not.toContain('<html');
	});
});

describe('an address that no route answers', () => {
	test('under a folder with a not-found, is answered by it', async () => {
		const answer = await ask('/blog/2024/january/first');

		expect(answer.status).toBe(404);
		expect(shows(answer, 'blog-not-found')).toBe(true);
	});

	test('anywhere else, is answered by the app’s', async () => {
		const answer = await ask('/nowhere/at/all');

		expect(answer.status).toBe(404);
		expect(shows(answer, 'app-not-found')).toBe(true);
	});

	/* `/blogger` starts with the same letters and is not under it. */
	test('a folder covers what is under it, not what merely starts the same', async () => {
		const answer = await ask('/blogger');

		expect(shows(answer, 'app-not-found')).toBe(true);
	});
});

describe('a Svelte route folder', () => {
	test('has its own error page', async () => {
		const answer = await ask('/docs/broken');

		expect(answer.status).toBe(500);
		expect(shows(answer, 'docs-error')).toBe(true);
	});

	test('and its own not-found, for a route and for an address under it', async () => {
		const thrown = await ask('/docs/missing');
		const unmatched = await ask('/docs/a/b');

		expect(thrown.status).toBe(404);
		expect(shows(thrown, 'docs-not-found')).toBe(true);
		expect(shows(unmatched, 'docs-not-found')).toBe(true);
	});

	test('and its routes still work', async () => {
		const answer = await ask('/docs/intro');

		expect(answer.status).toBe(200);
		expect(shows(answer, 'doc')).toBe(true);
	});
});

describe('an HTML route folder', () => {
	test('has its own not-found, for an address under it', async () => {
		const answer = await ask('/help/billing');

		expect(answer.status).toBe(404);
		expect(shows(answer, 'help-not-found')).toBe(true);
	});

	test('and its routes still work', async () => {
		const answer = await ask('/help/faq');

		expect(answer.status).toBe(200);
		expect(shows(answer, 'faq')).toBe(true);
	});
});

describe('a route that works', () => {
	test('is still just the page', async () => {
		const answer = await ask('/blog/hello');

		expect(answer.status).toBe(200);
		expect(shows(answer, 'post')).toBe(true);
	});
});
