import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { BunPlugin } from 'bun';

const CACHE_DIR = resolve('.cache', 'angular-linker');

/**
 * Bun bundler plugin that runs the Angular Linker on partially compiled
 * Angular libraries at build time. Converts ɵɵngDeclare* declarations
 * into fully AOT-compiled code so @angular/compiler is not shipped to
 * the browser.
 *
 * Uses a disk cache keyed by file content hash — Babel only runs once
 * per Angular package version. Subsequent builds are pure file reads.
 */
export const angularLinkerPlugin: BunPlugin = {
	name: 'angular-linker',
	setup(bld) {
		let needsLinking: ((path: string, source: string) => boolean) | undefined;
		let babelTransform: ((source: string, options: Record<string, unknown>) => { code?: string } | null) | undefined;
		let linkerPlugin: unknown;

		bld.onLoad(
			{ filter: /[\\/]@angular[\\/].*\.m?js$/ },
			async (args) => {
				const source = await Bun.file(args.path).text();

				if (!needsLinking) {
					const specifier = '@angular/compiler-cli/linker';
					const mod = await import(specifier);
					({ needsLinking } = mod);
				}

				const checkLink = needsLinking;
				if (!checkLink || !checkLink(args.path, source)) {
					return undefined;
				}

				const hash = createHash('md5')
					.update(source)
					.digest('hex');
				const cachePath = join(CACHE_DIR, `${hash}.js`);

				if (existsSync(cachePath)) {
					return {
						contents: readFileSync(cachePath, 'utf-8'),
						loader: 'js'
					};
				}

				if (!babelTransform) {
					const babelSpecifier = '@babel/core';
					const babel = await import(babelSpecifier);
					babelTransform = babel.transformSync;
				}
				if (!linkerPlugin) {
					const linkerSpecifier = '@angular/compiler-cli/linker/babel';
					const mod = await import(linkerSpecifier);
					linkerPlugin = mod.createEs2015LinkerPlugin({
						fileSystem: {
							dirname,
							exists: existsSync,
							readFile: readFileSync,
							relative,
							resolve
						},
						linkerJitMode: false,
						logger: {
							error: console.error,
							level: 1,
							warn: console.warn,
							debug: () => { /* noop */ },
							info: () => { /* noop */ }
						}
					});
				}

				const transform = babelTransform;
				if (!transform) {
					return { contents: source, loader: 'js' };
				}

				const result = transform(source, {
					compact: false,
					filename: args.path,
					filenameRelative: args.path,
					plugins: [linkerPlugin],
					sourceMaps: false
				});

				const linked = result?.code ?? source;

				mkdirSync(CACHE_DIR, { recursive: true });
				writeFileSync(cachePath, linked, 'utf-8');

				return { contents: linked, loader: 'js' };
			}
		);
	}
};
