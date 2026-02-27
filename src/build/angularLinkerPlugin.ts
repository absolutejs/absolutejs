import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { BunPlugin } from 'bun';
import { needsLinking } from '@angular/compiler-cli/linker';

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
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		let babelTransform: any;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		let linkerPlugin: any;

		bld.onLoad(
			{ filter: /[\\/]@angular[\\/].*\.m?js$/ },
			async (args) => {
				const source = await Bun.file(args.path).text();

				if (!needsLinking(args.path, source)) {
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
					const babel = await import(
						'@babel/core' as string
					);
					babelTransform = babel.transformSync;
				}
				if (!linkerPlugin) {
					const mod = await import(
						'@angular/compiler-cli/linker/babel' as string
					);
					linkerPlugin = mod.createEs2015LinkerPlugin({
						linkerJitMode: false,
						fileSystem: {
							resolve,
							exists: existsSync,
							dirname,
							relative,
							readFile: readFileSync
						} as any,
						logger: {
							level: 1,
							debug: () => {},
							info: () => {},
							warn: console.warn,
							error: console.error
						} as any
					});
				}

				const result = babelTransform(source, {
					filename: args.path,
					filenameRelative: args.path,
					plugins: [linkerPlugin],
					compact: false,
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
