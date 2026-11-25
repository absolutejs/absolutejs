import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseAngularProvidersImport } from '../../../src/build/parseAngularConfigImports';
import { scanAngularPageRoutes } from '../../../src/build/scanAngularPageRoutes';

/* Two build-time scanners that had no tests of their own: they were
 * covered only by whole builds of the example app. Written before the
 * two files were restructured to pass the lint, and run against the old
 * versions first, so what is pinned here is what they did. */

const directories: string[] = [];
const previousConfig = process.env.ABSOLUTE_CONFIG;

afterEach(async () => {
	if (previousConfig === undefined) delete process.env.ABSOLUTE_CONFIG;
	else process.env.ABSOLUTE_CONFIG = previousConfig;
	await Promise.all(
		directories
			.splice(0)
			.map((directory) => rm(directory, { force: true, recursive: true }))
	);
});

const project = async (files: Record<string, string>) => {
	const root = await mkdtemp(join(tmpdir(), 'absolute-angular-scan-'));
	directories.push(root);
	await Promise.all(
		Object.entries(files).map(async ([path, contents]) => {
			await mkdir(dirname(join(root, path)), { recursive: true });
			await writeFile(join(root, path), contents);
		})
	);
	delete process.env.ABSOLUTE_CONFIG;

	return root;
};

const config = (body: string, imports = '') =>
	`import { defineConfig } from '@absolutejs/absolute';\n${imports}\nexport default defineConfig(${body});\n`;

describe('parseAngularProvidersImport', () => {
	test('finds the module a relative providers import names', async () => {
		const root = await project({
			'absolute.config.ts': config(
				'{ angular: { providers: appProviders } }',
				"import { appProviders } from './src/providers.ts';"
			)
		});

		expect(parseAngularProvidersImport(root)).toEqual({
			absolutePath: join(root, 'src/providers'),
			bindingName: 'appProviders',
			importedName: 'appProviders'
		});
	});

	test('keeps the exported name when the import is renamed', async () => {
		const root = await project({
			'absolute.config.ts': config(
				'{ angular: { providers: mine } }',
				"import { type Other, appProviders as mine } from './providers';"
			)
		});

		expect(parseAngularProvidersImport(root)).toEqual({
			absolutePath: join(root, 'providers'),
			bindingName: 'mine',
			importedName: 'appProviders'
		});
	});

	test('leaves a package specifier as written', async () => {
		const root = await project({
			'absolute.config.ts': config(
				"{ 'angular': { 'providers': shared } }",
				"import { shared } from '@acme/providers';"
			)
		});

		expect(parseAngularProvidersImport(root)?.absolutePath).toBe(
			'@acme/providers'
		);
	});

	test('uses the first defineConfig call in the file', async () => {
		const root = await project({
			'absolute.config.ts': `import { defineConfig } from '@absolutejs/absolute';
import { first } from './first';
import { second } from './second';
const wrap = (value: unknown) => value;
export default wrap(defineConfig({ angular: { providers: first } }));
export const other = defineConfig({ angular: { providers: second } });
`
		});

		expect(parseAngularProvidersImport(root)?.bindingName).toBe('first');
	});

	test.each([
		['no config file', {}],
		['no angular field', { 'absolute.config.ts': config('{}') }],
		[
			'providers written inline, not imported',
			{
				'absolute.config.ts': config('{ angular: { providers: [] } }')
			}
		],
		[
			'a binding with no import',
			{
				'absolute.config.ts': config(
					'{ angular: { providers: appProviders } }',
					'const appProviders = [];'
				)
			}
		],
		[
			'a type-only import',
			{
				'absolute.config.ts': config(
					'{ angular: { providers: appProviders } }',
					"import type { appProviders } from './providers';"
				)
			}
		]
	])('is null with %s', async (_what, files) => {
		expect(parseAngularProvidersImport(await project(files))).toBeNull();
	});

	test('honours ABSOLUTE_CONFIG', async () => {
		const root = await project({
			'config/app.config.ts': config(
				'{ angular: { providers: appProviders } }',
				"import { appProviders } from '../providers';"
			)
		});
		process.env.ABSOLUTE_CONFIG = 'config/app.config.ts';

		expect(parseAngularProvidersImport(root)?.absolutePath).toBe(
			join(root, 'providers')
		);
	});
});

describe('scanAngularPageRoutes', () => {
	const byKey = (pages: ReturnType<typeof scanAngularPageRoutes>) =>
		[...pages].sort((left, right) =>
			left.pageFile.localeCompare(right.pageFile)
		);

	test('lists page files and says which export routes', async () => {
		const root = await project({
			'pages/about-us.ts': 'export class AboutUs {}\n',
			'pages/home.ts':
				"export const routes = [{ path: '' }];\nexport class Home {}\n",
			'pages/nested/deep/item.ts': 'export const routes = [];\n'
		});
		const pagesRoot = join(root, 'pages');

		expect(byKey(scanAngularPageRoutes(pagesRoot))).toEqual([
			{
				hasRoutes: false,
				manifestKey: 'AboutUs',
				pageFile: join(pagesRoot, 'about-us.ts')
			},
			{
				hasRoutes: true,
				manifestKey: 'Home',
				pageFile: join(pagesRoot, 'home.ts')
			},
			{
				hasRoutes: true,
				manifestKey: 'Item',
				pageFile: join(pagesRoot, 'nested/deep/item.ts')
			}
		]);
	});

	test('only an exported top-level `routes` counts', async () => {
		const root = await project({
			'pages/local.ts': 'const routes = [];\nexport class Local {}\n',
			'pages/mentioned.ts':
				"// routes are elsewhere\nexport const title = 'routes';\n",
			'pages/second.ts': 'export const title = 1, routes = [];\n'
		});
		const found = Object.fromEntries(
			scanAngularPageRoutes(join(root, 'pages')).map((page) => [
				page.manifestKey,
				page.hasRoutes
			])
		);

		expect(found).toEqual({ Local: false, Mentioned: false, Second: true });
	});

	test('skips tests, declarations, dot-directories and other files', async () => {
		const root = await project({
			'pages/.cache/hidden.ts': 'export const routes = [];\n',
			'pages/home.spec.ts': 'export const routes = [];\n',
			'pages/home.test.ts': 'export const routes = [];\n',
			'pages/home.ts': 'export class Home {}\n',
			'pages/node_modules/pkg/index.ts': 'export const routes = [];\n',
			'pages/notes.md': 'routes\n',
			'pages/types.d.ts': 'export declare const routes: unknown[];\n'
		});

		expect(
			scanAngularPageRoutes(join(root, 'pages')).map(
				(page) => page.manifestKey
			)
		).toEqual(['Home']);
	});

	test('a directory that is not there has no pages', () => {
		expect(
			scanAngularPageRoutes(join(tmpdir(), 'absolute-no-such'))
		).toEqual([]);
	});
});
