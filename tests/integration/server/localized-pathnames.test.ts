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

/* Localized pathnames, under `absolute start`.
 *
 * The table is in the config's `i18n` key and is applied by the running
 * server, from the config the production build carries. That hand-off
 * is the part no unit test covers: a key the production runtime does
 * not carry works from source and does nothing here.
 *
 * The CLI and the framework are this checkout's sources. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const CLI_ENTRY = join(repoRoot, 'src', 'cli', 'index.ts');
const fromSource = (path: string) =>
	join(repoRoot, 'src', path).replace(/\\/g, '/');
const PORT = 4653;

const FILES: Record<string, string> = {
	'absolute.config.ts': `import { defineConfig } from '${fromSource('index.ts')}';
import { routing } from './routing';

export default defineConfig({
	buildDirectory: './build',
	htmlDirectory: './html',
	i18n: routing,
	sitemap: { baseUrl: 'https://acme.test' }
});
`,
	'html/pages/Placeholder.html':
		'<!doctype html><html><head><title>p</title></head><body>p</body></html>\n',
	'package.json': JSON.stringify({
		name: 'localized-pathnames-fixture',
		type: 'module'
	}),
	'routing.ts': `import { defineI18nRouting } from '${fromSource('index.ts')}';

export const routing = defineI18nRouting({
	defaultLocale: 'en',
	locales: ['en', 'fr'],
	pathnames: {
		'/about': { fr: '/a-propos' },
		'/blog/:slug': { fr: '/articles/:slug' }
	}
});
`,
	'server.ts': `import { Elysia } from 'elysia';
import { defineI18n, i18nPlugin, networking, prepare } from '${fromSource('index.ts')}';
import { routing } from './routing';

const { absolutejs } = await prepare();
const i18n = defineI18n({
	...routing,
	loaders: { fr: { hello: 'Bonjour' } },
	messages: { hello: 'Hello' }
});

export const server = new Elysia()
	.use(absolutejs)
	.use(i18nPlugin(i18n))
	.get('/:locale?/about', ({ i18n: request }) => ({
		alternates: request.alternates().map((link) => link.href),
		hello: request.t('hello'),
		link: request.href('/blog/hello'),
		locale: request.locale
	}))
	.get('/:locale?/blog/:slug', ({ i18n: request, params }) => ({
		locale: request.locale,
		slug: params.slug
	}))
	.get('/ready', () => 'ready')
	.use(networking);
`,
	'tsconfig.json': JSON.stringify({ compilerOptions: {} })
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
	root = await mkdtemp(join(tmpdir(), 'absolute-localized-pathnames-'));
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

const ask = (path: string) => fetch(url(path), { redirect: 'manual' });

describe('localized pathnames, on a production server', () => {
	test('a locale’s own address is served by the route, in that locale', async () => {
		const response = await ask('/fr/a-propos');

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			// hreflang: each locale's own address for this page.
			alternates: [
				'http://localhost:4653/about',
				'http://localhost:4653/fr/a-propos',
				'http://localhost:4653/about'
			],
			hello: 'Bonjour',
			// A link written on a French page, to a French address.
			link: '/fr/articles/hello',
			locale: 'fr'
		});
	});

	test('params are carried across', async () => {
		expect(await (await ask('/fr/articles/hello')).json()).toEqual({
			locale: 'fr',
			slug: 'hello'
		});
	});

	test('the untranslated address redirects to the locale’s own', async () => {
		const response = await ask('/fr/about?ref=mail');

		expect(response.status).toBe(308);
		expect(response.headers.get('location')).toBe('/fr/a-propos?ref=mail');
	});

	test('the default locale keeps the route’s own address', async () => {
		const body = await (await ask('/about')).json();

		expect(body.hello).toBe('Hello');
		expect(body.locale).toBe('en');
		expect(body.link).toBe('/blog/hello');
	});
});
