import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
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
import { dirname, join, resolve } from 'node:path';
import { ensureDistBuild } from '../../helpers/ensureDistBuild';
import { getAvailablePort } from '../../helpers/ports';

/* The HTML and HTMX error.html conventions under `absolute start`. The
 * copies in build/conventions/{html,htmx}/ kept their source-relative
 * stylesheet URL (`../../styles/indexes/error-page.css`), which 404s once
 * served, so the error page rendered unstyled. They now get the same
 * hashed asset URLs as the pages in build/{html,htmx}/pages/. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const CLI_ENTRY = join(repoRoot, 'dist', 'cli', 'index.js');

const errorPage = (marker: string) => `<!doctype html>
<html>
	<head>
		<title>${marker}</title>
		<link rel="stylesheet" href="../../styles/indexes/error-page.css" />
	</head>
	<body><h1>${marker} {{ message }}</h1></body>
</html>
`;

const FILES: Record<string, string> = {
	'absolute.config.ts': `import { defineConfig } from '@absolutejs/absolute';

export default defineConfig({
	buildDirectory: './build',
	htmlDirectory: './html',
	htmxDirectory: './htmx',
	stylesConfig: './styles/indexes'
});
`,
	'html/pages/error.html': errorPage('HTML_ERROR_PAGE'),
	'html/pages/Home.html': `<!doctype html>
<html>
	<head>
		<title>home</title>
		<link rel="stylesheet" href="../../styles/indexes/error-page.css" />
	</head>
	<body>HOME_PAGE</body>
</html>
`,
	'htmx/pages/error.html': errorPage('HTMX_ERROR_PAGE'),
	'server.ts': `import { Elysia } from 'elysia';
import { asset, networking, prepare } from '@absolutejs/absolute';
import { handleHTMLPageRequest } from '@absolutejs/absolute';

const { absolutejs, manifest } = await prepare();

export const server = new Elysia()
	.use(absolutejs)
	.get('/', () => handleHTMLPageRequest(asset(manifest, 'Home')))
	.get('/throws', () => {
		throw new Error('route failed');
	})
	.use(networking);
`,
	'styles/indexes/error-page.css': 'h1 { letter-spacing: 7px; }\n'
};

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

let root = '';
let baseUrl = '';
let server: ReturnType<typeof Bun.spawn> | undefined;

const waitForServer = async () => {
	for (let attempt = 0; attempt < 480; attempt++) {
		if (server?.exitCode !== null && server?.exitCode !== undefined)
			throw new Error(`absolute start exited with ${server.exitCode}`);
		try {
			await fetch(`${baseUrl}/`);

			return;
		} catch {
			await Bun.sleep(250);
		}
	}
	throw new Error('production server did not start');
};

const stylesheetHrefs = (html: string) =>
	[...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*>/g)].map(
		([tag]) => tag.match(/href="([^"]+)"/)?.[1] ?? ''
	);

beforeAll(async () => {
	await ensureDistBuild();
	root = await mkdtemp(join(tmpdir(), 'absolute-prod-static-error-'));
	await Promise.all(
		Object.entries(FILES).map(async ([path, contents]) => {
			await mkdir(dirname(join(root, path)), { recursive: true });
			await writeFile(join(root, path), contents);
		})
	);
	await linkNodeModules(root);
	const port = await getAvailablePort();
	baseUrl = `http://localhost:${port}`;
	server = Bun.spawn(
		['bun', CLI_ENTRY, 'start', 'server.ts', '--outdir', 'start-build'],
		{
			cwd: root,
			env: {
				...process.env,
				FORCE_COLOR: '0',
				NODE_ENV: 'production',
				PORT: String(port),
				TELEMETRY_OFF: '1'
			},
			stderr: 'inherit',
			stdout: 'ignore'
		}
	);
	await waitForServer();
}, 600_000);

afterAll(async () => {
	server?.kill();
	await server?.exited;
	if (root) await rm(root, { force: true, recursive: true });
});

describe('production HTML/HTMX error.html stylesheets', () => {
	test('a throwing route renders error.html whose stylesheet loads with 200', async () => {
		const response = await fetch(`${baseUrl}/throws`, {
			headers: { accept: 'text/html' }
		});
		const html = await response.text();

		expect(response.status).toBe(500);
		expect(html).toContain('HTML_ERROR_PAGE');
		const hrefs = stylesheetHrefs(html);
		expect(hrefs).toHaveLength(1);
		const [href] = hrefs;
		expect(href).not.toContain('..');
		const css = await fetch(new URL(href ?? '', `${baseUrl}/throws`));
		expect(css.status).toBe(200);
		expect(await css.text()).toContain('letter-spacing: 7px');
	});

	test('an HTMX request gets the HTMX error.html with a working stylesheet', async () => {
		const response = await fetch(`${baseUrl}/throws`, {
			headers: { 'HX-Request': 'true' }
		});
		const html = await response.text();

		expect(response.status).toBe(500);
		expect(html).toContain('HTMX_ERROR_PAGE');
		const [href] = stylesheetHrefs(html);
		const css = await fetch(new URL(href ?? '', `${baseUrl}/throws`));
		expect(css.status).toBe(200);
	});

	test('the built convention copies point at the hashed stylesheet', async () => {
		const page = await readFile(
			join(root, 'start-build', 'html', 'pages', 'Home.html'),
			'utf8'
		);
		const [pageHref] = stylesheetHrefs(page);
		expect(pageHref).toMatch(/^\/.*error-page\.[^/]+\.css$/);
		for (const framework of ['html', 'htmx']) {
			const convention = await readFile(
				join(
					root,
					'start-build',
					'conventions',
					framework,
					'error.html'
				),
				'utf8'
			);
			expect(stylesheetHrefs(convention)).toEqual([pageHref ?? '']);
		}
	});
});
