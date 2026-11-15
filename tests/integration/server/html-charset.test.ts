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
import { dirname, join, resolve } from 'node:path';
import { openPage } from '../../helpers/browser';
import { ensureDistBuild } from '../../helpers/ensureDistBuild';
import { getAvailablePort } from '../../helpers/ports';

/* Page responses sent `Content-Type: text/html` with no charset. A page
 * without its own <meta charset> is then decoded as windows-1252, and a
 * Svelte page in Arabic rendered as mojibake. Every page handler now sends
 * `text/html; charset=utf-8`. These pages have no <meta charset>, so the
 * header alone decides how the browser decodes them. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const CLI_ENTRY = join(repoRoot, 'dist', 'cli', 'index.js');

const ARABIC = 'مرحبا بالعالم';

const FILES: Record<string, string> = {
	'absolute.config.ts': `import { defineConfig } from '@absolutejs/absolute';

export default defineConfig({
	buildDirectory: 'build',
	htmlDirectory: 'src/frontend/html',
	htmxDirectory: 'src/frontend/htmx',
	reactDirectory: 'src/frontend/react',
	svelteDirectory: 'src/frontend/svelte',
	vueDirectory: 'src/frontend/vue'
});
`,
	'package.json': `{ "name": "html-charset-app", "private": true, "type": "module" }
`,
	'src/backend/server.ts': `import { Elysia } from 'elysia';
import {
	asset,
	handleHTMLPageRequest,
	handleHTMXPageRequest,
	networking,
	prepare
} from '@absolutejs/absolute';
import { handleReactPageRequest } from '@absolutejs/absolute/react';
import { handleSveltePageRequest } from '@absolutejs/absolute/svelte';
import { handleVuePageRequest } from '@absolutejs/absolute/vue';
import { Arabic } from '../frontend/react/pages/Arabic';

const { absolutejs, manifest } = await prepare();

export const server = new Elysia()
	.use(absolutejs)
	.get('/svelte', () =>
		handleSveltePageRequest({
			indexPath: asset(manifest, 'SvelteArabicIndex'),
			pagePath: asset(manifest, 'SvelteArabic')
		})
	)
	.get('/react', () =>
		handleReactPageRequest({
			index: asset(manifest, 'ArabicIndex'),
			Page: Arabic,
			props: {}
		})
	)
	.get('/vue', () =>
		handleVuePageRequest({
			indexPath: asset(manifest, 'VueArabicIndex'),
			pagePath: asset(manifest, 'VueArabic'),
			props: {}
		})
	)
	.get('/html', () => handleHTMLPageRequest(asset(manifest, 'HtmlArabic')))
	.get('/htmx', () => handleHTMXPageRequest(asset(manifest, 'HtmxArabic')))
	.use(networking);
`,
	'src/frontend/html/pages/HtmlArabic.html': `<!doctype html>
<html dir="rtl">
	<head>
		<title>html</title>
	</head>
	<body>
		<h1>${ARABIC}</h1>
	</body>
</html>
`,
	'src/frontend/htmx/pages/HtmxArabic.html': `<!doctype html>
<html dir="rtl">
	<head>
		<title>htmx</title>
	</head>
	<body>
		<h1>${ARABIC}</h1>
	</body>
</html>
`,
	'src/frontend/react/pages/Arabic.tsx': `export const Arabic = () => (
	<html dir="rtl">
		<head>
			<title>react</title>
		</head>
		<body>
			<h1>${ARABIC}</h1>
		</body>
	</html>
);
`,
	'src/frontend/svelte/pages/SvelteArabic.svelte': `<script lang="ts">
	let count = $state(0);
</script>

<h1>${ARABIC}</h1>
<button onclick={() => (count += 1)} type="button">{count}</button>
`,
	'src/frontend/vue/pages/VueArabic.vue': `<template>
	<h1>${ARABIC}</h1>
</template>
`,
	'tsconfig.json': `{
	"compilerOptions": {
		"jsx": "react-jsx",
		"module": "esnext",
		"moduleResolution": "bundler",
		"skipLibCheck": true,
		"strict": true,
		"target": "esnext"
	}
}
`
};

const ROUTES = ['/svelte', '/react', '/vue', '/html', '/htmx'];

/* Every package from the repo's node_modules, except @absolutejs/absolute,
 * which points at this checkout. */
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

/* What a browser does with a page that has no <meta charset> and no BOM:
 * the header's charset, else (for these locales) windows-1252. */
const decodeAsBrowser = (bytes: Uint8Array, contentType: string) => {
	const charset =
		/charset=([^;\s]+)/i.exec(contentType)?.[1] ?? 'windows-1252';

	return new TextDecoder(charset).decode(bytes);
};

let root = '';
let baseUrl = '';
let server: ReturnType<typeof Bun.spawn> | undefined;

beforeAll(async () => {
	await ensureDistBuild();
	root = await mkdtemp(join(tmpdir(), 'absolute-html-charset-'));
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
		[
			'bun',
			CLI_ENTRY,
			'start',
			'src/backend/server.ts',
			'--outdir',
			'start-build'
		],
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
	for (let attempt = 0; attempt < 480; attempt++) {
		if (server.exitCode !== null)
			throw new Error(`absolute start exited with ${server.exitCode}`);
		try {
			if ((await fetch(`${baseUrl}/svelte`)).ok) return;
		} catch {
			// not listening yet
		}
		await Bun.sleep(250);
	}
	throw new Error('absolute start did not start');
}, 600_000);

afterAll(async () => {
	server?.kill();
	await server?.exited;
	if (root) await rm(root, { force: true, recursive: true });
});

describe('page responses name their charset', () => {
	test('every page sends text/html; charset=utf-8 and decodes to the Arabic text', async () => {
		for (const route of ROUTES) {
			const response = await fetch(`${baseUrl}${route}`);
			const contentType = response.headers.get('content-type') ?? '';
			const bytes = new Uint8Array(await response.arrayBuffer());
			const text = decodeAsBrowser(bytes, contentType);
			expect({ contentType, route }).toEqual({
				contentType: 'text/html; charset=utf-8',
				route
			});
			expect(text).not.toMatch(/<meta[^>]*charset/i);
			expect({ arabic: text.includes(ARABIC), route }).toEqual({
				arabic: true,
				route
			});
			// Without the header's charset the same bytes are mojibake.
			expect(decodeAsBrowser(bytes, 'text/html')).not.toContain(ARABIC);
		}
	}, 60_000);

	test('a Svelte page with no <meta charset> shows Arabic in the browser', async () => {
		const session = await openPage(`${baseUrl}/svelte`);
		try {
			const { page } = session;
			expect(await page.evaluate(() => document.characterSet)).toBe(
				'UTF-8'
			);
			expect(await page.textContent('h1')).toBe(ARABIC);
			// Hydrated, and the text is still right afterwards.
			await page.click('button');
			await page.waitForFunction(
				() => document.querySelector('button')?.textContent === '1',
				undefined,
				{ timeout: 15_000 }
			);
			expect(await page.textContent('h1')).toBe(ARABIC);
		} finally {
			await session.close();
		}
	}, 60_000);
});
