import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	createMissingClientFrameworkPlugin,
	isPackageInstalled,
	missingFrameworkSpecifierPattern,
	resolveMissingClientFrameworks
} from '../../../src/build/missingClientFrameworks';

const installedOnly =
	(...installed: string[]) =>
	(packageName: string) =>
		installed.includes(packageName);

describe('resolveMissingClientFrameworks', () => {
	test('lists every framework that is neither configured nor installed', () => {
		expect(
			resolveMissingClientFrameworks({
				configured: { svelte: '/app/svelte' },
				isInstalled: installedOnly('svelte'),
				projectRoot: '/app'
			})
		).toEqual(['angular', 'react', 'vue']);
	});

	test('an installed framework is never missing, configured or not', () => {
		expect(
			resolveMissingClientFrameworks({
				configured: { vue: '/app/vue' },
				isInstalled: installedOnly('vue', 'react'),
				projectRoot: '/app'
			})
		).toEqual(['angular', 'svelte']);
	});

	test('a configured framework is never missing, even when absent', () => {
		expect(
			resolveMissingClientFrameworks({
				configured: {
					angular: '/a',
					react: '/r',
					svelte: '/s',
					vue: '/v'
				},
				isInstalled: installedOnly(),
				projectRoot: '/app'
			})
		).toEqual([]);
	});
});

describe('missingFrameworkSpecifierPattern', () => {
	const pattern = missingFrameworkSpecifierPattern(['angular', 'react', 'vue']);

	test.each([
		'react',
		'react/jsx-runtime',
		'react-dom',
		'react-dom/client',
		'vue',
		'vue-demi',
		'@vue/runtime-dom',
		'@angular/core',
		'@angular/platform-browser'
	])('matches %s', (specifier) => {
		expect(pattern?.test(specifier)).toBe(true);
	});

	test.each(['svelte', 'reactive', 'vuex', 'preact', '@angularx/core', 'react-router'])(
		'does not match %s',
		(specifier) => {
			expect(pattern?.test(specifier)).toBe(false);
		}
	);

	test('is null when nothing is missing', () => {
		expect(missingFrameworkSpecifierPattern([])).toBeNull();
		expect(createMissingClientFrameworkPlugin([])).toBeNull();
	});
});

describe('createMissingClientFrameworkPlugin', () => {
	/* Without code splitting Bun inlines lazily imported modules and hoists
	 * their imports, so a missing runtime must not be left as a bare
	 * specifier: the bundle has to load, and only the lazy import may fail. */
	test.each([false, true])(
		'bundles load and the lazy import throws a clear error (splitting: %p)',
		async (splitting) => {
			const root = await mkdtemp(join(tmpdir(), 'absolute-missing-fw-'));
			try {
				await writeFile(
					join(root, 'hydrator.js'),
					`import { createSSRApp, h } from 'vue';\nexport const run = () => createSSRApp({ render: () => h('p') });\n`
				);
				await writeFile(
					join(root, 'entry.js'),
					`export const hydrate = async () => {\n\ttry {\n\t\t(await import('./hydrator.js')).run();\n\t\treturn 'hydrated';\n\t} catch (error) {\n\t\treturn error.message;\n\t}\n};\n`
				);
				const plugin = createMissingClientFrameworkPlugin(['vue']);
				const result = await Bun.build({
					entrypoints: [join(root, 'entry.js')],
					format: 'esm',
					outdir: join(root, 'out'),
					plugins: plugin ? [plugin] : [],
					splitting,
					target: 'browser'
				});
				expect(result.success).toBe(true);
				const output = await Bun.file(join(root, 'out', 'entry.js')).text();
				expect(output).not.toMatch(/from\s*["']vue["']/);

				const loaded: unknown = await import(join(root, 'out', 'entry.js'));
				const hydrate =
					typeof loaded === 'object' && loaded !== null && 'hydrate' in loaded
						? loaded.hydrate
						: undefined;
				expect(typeof hydrate).toBe('function');
				if (typeof hydrate !== 'function') return;
				expect(await hydrate()).toContain('"vue" is not installed');
			} finally {
				await rm(root, { force: true, recursive: true });
			}
		}
	);
});

describe('isPackageInstalled', () => {
	test('finds packages in the project or an ancestor node_modules', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolute-installed-'));
		try {
			const projectRoot = join(root, 'apps', 'web');
			await mkdir(join(root, 'node_modules', '@angular', 'core'), {
				recursive: true
			});
			await writeFile(
				join(root, 'node_modules', '@angular', 'core', 'package.json'),
				'{"name":"@angular/core"}'
			);
			await mkdir(projectRoot, { recursive: true });

			expect(isPackageInstalled('@angular/core', projectRoot)).toBe(true);
			expect(isPackageInstalled('vue', projectRoot)).toBe(false);
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	});
});
