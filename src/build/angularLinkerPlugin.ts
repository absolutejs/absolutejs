import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { BunPlugin } from 'bun';

const CACHE_ROOT = resolve('.absolutejs', 'cache', 'angular-linker');

/* Files worth offering to the linker. `node_modules` covers an ordinary
 * install; `dist/angular/` covers this framework's own output when the
 * package is reached through a SYMLINK — a `bun link`, a workspace
 * dependency, a `file:` install or the integration fixtures. Bun hands
 * `onLoad` the real path, not the symlinked one, so such a package never
 * matches the `node_modules` branch; its components then stay partially
 * compiled, Angular falls back to its JIT compiler in the browser, and a
 * nonce CSP (what `secureHeaders()` sends) blocks that outright with
 * "'unsafe-eval' is not an allowed source of script" and the page never
 * hydrates.
 *
 * Widening this costs one file read per candidate: the handler below asks
 * Angular's own `needsLinking` before transforming anything. A symlinked
 * THIRD-PARTY Angular library is still missed, since nothing in its path
 * says Angular. */
export const ANGULAR_LINKER_CANDIDATE_RE =
	/(?:[\\/]node_modules[\\/]|[\\/]dist[\\/]angular[\\/]).*\.m?js$/;

/**
 * Bun bundler plugin that runs the Angular Linker on partially compiled
 * Angular libraries at build time. Converts ɵɵngDeclare* declarations
 * into fully linked code.
 *
 * The `linkerJitMode` flag controls whether NgModule definitions retain
 * `declarations`/`exports` (JIT-mode, required when consumer code is
 * runtime-compiled) or strip them (AOT-mode, smaller output but only
 * correct when consumer components have ɵcmp.dependencies baked in by
 * the Angular compiler-cli).
 *
 * In AbsoluteJS dev/HMR, user components are TypeScript-transpiled via
 * `compileAngularFileJIT` and rely on @angular/compiler at runtime —
 * that runtime JIT path reads `NgModule.ɵmod.declarations` to find
 * directives like FormGroupDirective. Linking vendor code in AOT mode
 * (the default) silently breaks dev because declarations get stripped
 * and runtime JIT then can't resolve `[formGroup]`, `[ngIf]`, etc. So
 * dev/HMR builds must use `linkerJitMode: true`. Production AOT builds
 * use `linkerJitMode: false` (matches AOT'd user components).
 *
 * Cache key includes mode so dev and prod artifacts don't collide.
 */
export const createAngularLinkerPlugin = (
	linkerJitMode: boolean
): BunPlugin => ({
	name: 'angular-linker',
	setup(bld) {
		let needsLinking:
			((path: string, source: string) => boolean) | undefined;
		let babelTransform:
			| ((
					source: string,
					options: Record<string, unknown>
			  ) => { code?: string } | null)
			| undefined;
		let linkerPlugin: unknown;

		const cacheDir = join(CACHE_ROOT, linkerJitMode ? 'jit' : 'aot');

		bld.onLoad({ filter: ANGULAR_LINKER_CANDIDATE_RE }, async (args) => {
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

			const hash = createHash('md5').update(source).digest('hex');
			const cachePath = join(cacheDir, `${hash}.js`);

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
					linkerJitMode,
					logger: {
						error: console.error,
						level: 1,
						warn: console.warn,
						debug: () => {
							/* noop */
						},
						info: () => {
							/* noop */
						}
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

			mkdirSync(cacheDir, { recursive: true });
			writeFileSync(cachePath, linked, 'utf-8');

			return { contents: linked, loader: 'js' };
		});
	}
});

/** Default AOT-mode plugin instance — keep for callers that don't need
 *  to choose. Production AOT builds and any callsite that AOT-compiles
 *  user components alongside vendor should use this. */
export const angularLinkerPlugin = createAngularLinkerPlugin(false);
