import { afterAll, describe, expect, test } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/* <abs-include> layouts and partials for HTML and HTMX pages, expanded at
 * build time before asset paths, images and islands are processed. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const fixtures: string[] = [];

const LAYOUT = `<!doctype html>
<html>
	<head>
		<abs-slot name="head"><title>DEFAULT_TITLE</title></abs-slot>
		<link rel="stylesheet" href="../../styles/indexes/site.css" />
	</head>
	<body>
		<abs-include src="../partials/header.html"></abs-include>
		<main><abs-slot></abs-slot></main>
		<footer><abs-slot name="footer">FOOTER_FALLBACK</abs-slot></footer>
	</body>
</html>
`;

const BASE_FILES: Record<string, string> = {
	'html/layouts/base.html': LAYOUT,
	'html/pages/About.html': `<abs-include src="../layouts/base.html">
	<template slot="head"><title>ABOUT_TITLE</title></template>
	<h1>ABOUT_BODY</h1>
	<abs-include src="../partials/counter.html"></abs-include>
</abs-include>
`,
	'html/partials/counter.html':
		'<section class="counter"><absolute-island framework="react" component="Counter" props=\'{"start":7}\'></absolute-island></section>\n',
	'html/partials/header.html':
		'<header>SITE_HEADER <abs-include src="nav.html"></abs-include></header>\n',
	'html/partials/nav.html': '<nav>NESTED_NAV</nav>\n',
	'htmx/layouts/base.html':
		'<!doctype html><html><head><title>HTMX</title></head><body><abs-slot></abs-slot></body></html>\n',
	'htmx/pages/Fragments.html':
		'<abs-include src="../layouts/base.html"><p>HTMX_BODY</p></abs-include>\n',
	'islands/Counter.tsx':
		'export const Counter = ({ start }: { start: number }) => <output>COUNT_{start}</output>;\n',
	'islands/registry.ts': `import { defineIslandRegistry } from ${JSON.stringify(join(repoRoot, 'src', 'islands', 'index.ts'))};
import { Counter } from './Counter';

export const islandRegistry = defineIslandRegistry({ react: { Counter } });
`,
	'styles/indexes/site.css': 'body { color: rgb(1, 2, 3); }\n'
};

const createProject = async (name: string, files: Record<string, string>) => {
	const root = join(
		repoRoot,
		'.test-builds',
		`html-includes-${name}-${process.pid}`
	);
	fixtures.push(root);
	await Promise.all(
		Object.entries(files).map(async ([path, source]) => {
			await mkdir(join(root, path, '..'), { recursive: true });
			await writeFile(join(root, path), source);
		})
	);
	await writeFile(
		join(root, 'build.ts'),
		`import { build } from ${JSON.stringify(join(repoRoot, 'src', 'core', 'build.ts'))};

const result = await build({
	buildDirectory: 'build',
	htmlDirectory: 'html',
	htmxDirectory: 'htmx',
	islands: { registry: 'islands/registry.ts' },
	mode: 'production',
	options: { throwOnError: true },
	stylesConfig: 'styles/indexes'
});
console.log('MANIFEST' + JSON.stringify(result?.manifest ?? {}));
`
	);
	const proc = Bun.spawn(['bun', join(root, 'build.ts')], {
		cwd: root,
		env: { ...process.env, FORCE_COLOR: '0', TELEMETRY_OFF: '1' },
		stderr: 'pipe',
		stdout: 'pipe'
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text()
	]);
	const line = stdout.split('\n').find((entry) => entry.startsWith('MANIFEST'));
	const manifest: Record<string, string> = line
		? JSON.parse(line.slice('MANIFEST'.length))
		: {};

	return { exitCode, manifest, output: `${stdout}\n${stderr}`, root };
};

afterAll(async () => {
	await Promise.all(
		fixtures.map((root) => rm(root, { force: true, recursive: true }))
	);
});

describe('HTML includes', () => {
	test('a layout with named slots and nested includes builds into the page', async () => {
		const { exitCode, manifest, output } = await createProject(
			'layout',
			BASE_FILES
		);
		expect(output).not.toContain('error');
		expect(exitCode).toBe(0);
		const about = await readFile(manifest.About ?? '', 'utf8');

		expect(about).toContain('<title>ABOUT_TITLE</title>');
		expect(about).not.toContain('DEFAULT_TITLE');
		expect(about).toContain('SITE_HEADER <nav>NESTED_NAV</nav>');
		expect(about).toContain('<h1>ABOUT_BODY</h1>');
		expect(about).toContain('<footer>FOOTER_FALLBACK</footer>');
		expect(about).not.toMatch(/abs-include|abs-slot|<template/);

		// The stylesheet link came from the layout: it gets the hashed path.
		expect(about).toMatch(/href="\/indexes\/site\.[a-z0-9]+\.css"/);
		expect(about).not.toContain('styles/indexes/site.css');

		// The island came from a partial: it is server-rendered and marked
		// for hydration like one written in the page.
		expect(about).toContain('data-island="true"');
		expect(about).toMatch(/<output>COUNT_(?:<!-- -->)?7<\/output>/);

		const fragments = await readFile(manifest.Fragments ?? '', 'utf8');
		expect(fragments).toContain('<body><p>HTMX_BODY</p>');
	}, 120_000);

	test('partials and layouts are not pages', async () => {
		const { manifest } = await createProject('pages-only', BASE_FILES);

		expect(Object.keys(manifest)).not.toContain('Header');
		expect(Object.keys(manifest)).not.toContain('Base');
		expect(Object.keys(manifest)).not.toContain('Counter');
	}, 120_000);

	test('an include cycle fails the build with the chain', async () => {
		const { exitCode, output } = await createProject('cycle', {
			'html/pages/Loop.html':
				'<abs-include src="../partials/a.html"></abs-include>\n',
			'html/partials/a.html': '<abs-include src="b.html"></abs-include>\n',
			'html/partials/b.html': '<abs-include src="a.html"></abs-include>\n',
			'htmx/pages/Ok.html': '<p>ok</p>\n',
			'islands/registry.ts': BASE_FILES['islands/registry.ts'] ?? '',
			'islands/Counter.tsx': BASE_FILES['islands/Counter.tsx'] ?? '',
			'styles/indexes/site.css': ''
		});

		expect(exitCode).not.toBe(0);
		expect(output).toContain('Include cycle: html/partials/a.html');
		expect(output).toContain(
			'html/pages/Loop.html → html/partials/a.html → html/partials/b.html → html/partials/a.html'
		);
	}, 120_000);
});
