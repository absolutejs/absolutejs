import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'bun';
import { describe, expect, test } from 'bun:test';
import { scanCssEntryPoints } from '../../../src/build/scanCssEntryPoints';
import {
	compileStyleSource,
	createStylePreprocessorPlugin,
	stylePreprocessorPlugin
} from '../../../src/build/stylePreprocessor';

describe('stylePreprocessor', () => {
	test('runs configured PostCSS plugins for plain and preprocessed CSS', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolutejs-postcss-'));

		try {
			const cssPath = join(root, 'plain.css');
			const scssPath = join(root, 'theme.scss');
			await writeFile(cssPath, '.plain { color: red; }');
			await writeFile(scssPath, '$tone: blue; .theme { color: $tone; }');
			const config = {
				postcss: {
					plugins: [
						{
							postcssPlugin: 'absolute-test-postcss',
							Declaration(decl: { prop: string; value: string }) {
								if (decl.prop === 'color') decl.value = 'black';
							}
						}
					]
				}
			};

			await expect(
				compileStyleSource(cssPath, undefined, undefined, config)
			).resolves.toContain('color: black');
			await expect(
				compileStyleSource(scssPath, undefined, undefined, config)
			).resolves.toContain('color: black');
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	});

	test('compiles Sass, SCSS, Less, and Stylus source to CSS', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolutejs-styles-'));

		try {
			const scss = join(root, 'theme.scss');
			const sass = join(root, 'layout.sass');
			const less = join(root, 'tokens.less');
			const stylus = join(root, 'legacy.styl');
			await writeFile(
				scss,
				'$accent: #0f766e; .button { color: $accent; }'
			);
			await writeFile(sass, '$space: 12px\n.panel\n  padding: $space\n');
			await writeFile(less, '@radius: 6px; .card { border-radius: @radius; }');
			await writeFile(stylus, 'accent = #2563eb\n.badge\n  color accent\n');

			await expect(compileStyleSource(scss)).resolves.toContain(
				'color: #0f766e'
			);
			await expect(compileStyleSource(sass)).resolves.toContain(
				'padding: 12px'
			);
			await expect(compileStyleSource(less)).resolves.toContain(
				'border-radius: 6px'
			);
			await expect(compileStyleSource(stylus)).resolves.toContain(
				'color: #2563eb'
			);
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	});

	test('preserves Bun CSS module exports and :export values for module preprocessor imports', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolutejs-css-modules-'));

		try {
			const entry = join(root, 'entry.ts');
			const modulePath = join(root, 'theme.module.scss');
			await writeFile(
				modulePath,
				'$tone: red; :export { brand: $tone; } .title { color: $tone; }'
			);
			await writeFile(
				entry,
				'import styles from "./theme.module.scss"; console.log(styles.title, styles.brand);'
			);

			const result = await build({
				entrypoints: [entry],
				outdir: join(root, 'out'),
				plugins: [stylePreprocessorPlugin],
				target: 'browser',
				throw: false
			});

			expect(result.success).toBe(true);
			const js = await result.outputs
				.find((output) => output.path.endsWith('.js'))
				?.text();
			const css = await result.outputs
				.find((output) => output.path.endsWith('.css'))
				?.text();

			expect(js).toMatch(/title: "title_[A-Za-z0-9_-]+"/);
			expect(js).toMatch(/brand: "red"/);
			expect(css).toContain('color: red');
			expect(css).toMatch(/\.title_[A-Za-z0-9_-]+/);
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	});

	test('resolves configured aliases and rebases urls from imported styles', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolutejs-style-alias-'));

		try {
			const shared = join(root, 'shared');
			await mkdir(shared, { recursive: true });
			await writeFile(join(shared, '_tokens.scss'), '.icon { background-image: url("./icon.svg"); }');
			await writeFile(join(shared, 'colors.styl'), 'brand = #16a34a');
			await writeFile(join(shared, 'icon.svg'), '<svg />');
			const scss = join(root, 'theme.scss');
			const stylus = join(root, 'theme.styl');
			await writeFile(scss, '@use "@theme/tokens"; .button { color: #111827; }');
			await writeFile(stylus, '@import "@theme/colors"\n.badge\n  color brand\n');

			const css = await compileStyleSource(scss, undefined, undefined, {
				aliases: {
					'@theme/*': join(shared, '*')
				}
			});
			const stylusCss = await compileStyleSource(stylus, undefined, undefined, {
				aliases: {
					'@theme/*': join(shared, '*')
				}
			});

			expect(css).toContain('.icon');
			expect(css).toContain('url("./shared/icon.svg")');
			expect(stylusCss).toContain('color: #16a34a');
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	});

	test('applies configured additional data and load paths', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolutejs-style-options-'));

		try {
			const shared = join(root, 'shared');
			await mkdir(shared, { recursive: true });
			await writeFile(join(shared, '_tokens.scss'), '$brand: #7c3aed;');
			await writeFile(join(shared, 'tokens.less'), '@brand: #0891b2;');
			const scss = join(root, 'theme.scss');
			const less = join(root, 'theme.less');
			await writeFile(scss, '.button { color: tokens.$brand; background: $surface; }');
			await writeFile(less, '@import "tokens.less"; .card { color: @brand; background: @surface; }');

			await expect(
				compileStyleSource(scss, undefined, undefined, {
					scss: {
						additionalData:
							'@use "tokens"; $surface: #f8fafc;',
						loadPaths: [shared]
					}
				})
			).resolves.toContain('background: #f8fafc');
			await expect(
				compileStyleSource(less, undefined, undefined, {
					less: {
						additionalData: '@surface: #ecfeff;',
						paths: [shared]
					}
				})
			).resolves.toContain('background: #ecfeff');
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	});

	test('applies configured options inside Bun style plugin builds', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolutejs-style-plugin-options-'));

		try {
			const entry = join(root, 'entry.ts');
			const modulePath = join(root, 'theme.module.styl');
			await writeFile(modulePath, '.title\n  color brand\n');
			await writeFile(
				entry,
				'import styles from "./theme.module.styl"; console.log(styles.title);'
			);

			const result = await build({
				entrypoints: [entry],
				outdir: join(root, 'out'),
				plugins: [
					createStylePreprocessorPlugin({
						stylus: { additionalData: 'brand = #db2777' }
					})
				],
				target: 'browser',
				throw: false
			});

			expect(result.success).toBe(true);
			const css = await result.outputs
				.find((output) => output.path.endsWith('.css'))
				?.text();

			expect(css).toContain('color: #db2777');
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	});

	test('applies PostCSS inside Bun style plugin builds', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolutejs-postcss-plugin-'));

		try {
			const entry = join(root, 'entry.ts');
			const cssPath = join(root, 'plain.css');
			await writeFile(cssPath, '.plain { display: flex; }');
			await writeFile(entry, 'import "./plain.css";');

			const result = await build({
				entrypoints: [entry],
				outdir: join(root, 'out'),
				plugins: [
					createStylePreprocessorPlugin({
						postcss: {
							plugins: [
								{
									postcssPlugin: 'absolute-test-bun-postcss',
									Rule(rule: { append(input: { prop: string; value: string }): void }) {
										rule.append({
											prop: '--postcss-proof',
											value: '1'
										});
									}
								}
							]
						}
					})
				],
				target: 'browser',
				throw: false
			});

			expect(result.success).toBe(true);
			const css = await result.outputs
				.find((output) => output.path.endsWith('.css'))
				?.text();

			expect(css).toContain('--postcss-proof: 1');
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	});


	test('scans style entrypoints and skips CSS module files', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolutejs-style-scan-'));

		try {
			await writeFile(join(root, 'main.css'), 'body {}');
			await writeFile(join(root, 'theme.scss'), '.theme {}');
			await writeFile(join(root, 'legacy.less'), '.legacy {}');
			await writeFile(join(root, 'tokens.styl'), '.tokens\n  color red\n');
			await writeFile(join(root, 'card.module.scss'), '.card {}');

			const entries = await scanCssEntryPoints(root);
			const relativeEntries = entries.map((entry) =>
				entry.slice(root.length + 1)
			);

			expect(relativeEntries.sort()).toEqual([
				'legacy.less',
				'main.css',
				'theme.scss',
				'tokens.styl'
			]);
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	});
});
