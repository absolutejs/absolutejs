import { $, type BunPlugin } from 'bun';
import {
	rm,
	cp,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	stat,
	writeFile
} from 'node:fs/promises';
import { dirname, join, resolve, relative } from 'node:path';
import type { AngularCompilerOptions } from '@angular/compiler-cli';
import ts from 'typescript';

/* The two vendored Angular translator files have a top-level static
   `import * as o from '@angular/compiler';`. Because `@angular/compiler`
   is in EXTERNALS, that bare specifier survives unchanged into
   `dist/index.js`, so any project that imports `@absolutejs/absolute`
   without `@angular/compiler` installed (Vue/Svelte/React-only) fails
   at module load: `Cannot find module '@angular/compiler'`.

   This plugin rewrites that single line at bundle time into a
   `require('@angular/compiler')` guarded by a deep-proxy stub fallback.
   The on-disk source stays vendored verbatim — re-pulling from upstream
   does not require re-patching, as long as the static import shape
   matches the regex below. The translator is only ever invoked from
   Angular HMR code paths, which never execute in non-Angular projects,
   so the stub branch is never exercised functionally. */
const lazyAngularCompilerPlugin: BunPlugin = {
	name: 'absolutejs-lazy-angular-compiler',
	setup(build) {
		const targetPattern =
			/vendor[\\/]translator[\\/](?:translator|typescript_translator)\.ts$/;
		const importPattern =
			/^\s*import\s+\*\s+as\s+o\s+from\s+['"]@angular\/compiler['"];?\s*$/m;
		const replacement =
			"const o = (() => { try { return require('@angular/compiler'); } " +
			'catch { const stub = new Proxy(function () {}, { ' +
			'apply: () => stub, construct: () => stub, get: () => stub }); ' +
			'return stub; } })();';

		build.onLoad({ filter: targetPattern }, async (args) => {
			const source = await readFile(args.path, 'utf8');
			if (!importPattern.test(source)) {
				throw new Error(
					`absolutejs-lazy-angular-compiler: expected static \`import * as o from '@angular/compiler'\` in ${args.path}; vendor file may have changed shape — re-check the patch.`
				);
			}

			return {
				contents: source.replace(importPattern, replacement),
				loader: 'ts'
			};
		});
	}
};

const DIST = 'dist';
const BUILD_LOCK_DIR = '.absolute-build.lock';
const BUILD_LOCK_TIMEOUT_MS = 120_000;
const BUILD_LOCK_STALE_MS = 10 * 60_000;

const runSequentially = <Item>(
	items: Item[],
	action: (item: Item) => Promise<void>
) =>
	items.reduce(
		(chain, item) => chain.then(() => action(item)),
		Promise.resolve()
	);

const isAlreadyExistsError = (error: unknown) =>
	error instanceof Error && 'code' in error && error.code === 'EEXIST';

const removeStaleBuildLock = async () => {
	try {
		const lockStat = await stat(BUILD_LOCK_DIR);
		if (Date.now() - lockStat.mtimeMs <= BUILD_LOCK_STALE_MS) return;
		await rm(BUILD_LOCK_DIR, {
			force: true,
			recursive: true
		});
	} catch {
		// The lock was removed between attempts.
	}
};

const acquireBuildLock = async (start = Date.now()) => {
	try {
		await mkdir(BUILD_LOCK_DIR);
		await writeFile(
			join(BUILD_LOCK_DIR, 'owner'),
			`${process.pid}\n${new Date().toISOString()}\n`
		);
	} catch (error) {
		if (!isAlreadyExistsError(error)) throw error;
		await removeStaleBuildLock();

		if (Date.now() - start > BUILD_LOCK_TIMEOUT_MS) {
			throw new Error(
				`Timed out waiting for build lock: ${BUILD_LOCK_DIR}`,
				{ cause: error }
			);
		}

		await Bun.sleep(250);

		await acquireBuildLock(start);
	}
};

const withBuildLock = async (action: () => Promise<void>) => {
	await acquireBuildLock();
	try {
		await action();
	} finally {
		await rm(BUILD_LOCK_DIR, { force: true, recursive: true }).catch(() => {
			/* lock dir already removed */
		});
	}
};

const SERVER_ENTRY_POINTS = [
	'src/index.ts',
	'src/build.ts',
	'src/angular/index.ts',
	'src/angular/browser.ts',
	'src/angular/server.ts',
	'src/islands/browser.ts',
	'src/islands/index.ts',
	'src/mobile/browser.ts',
	'src/mobile/index.ts',
	'src/react/index.ts',
	'src/react/browser.ts',
	'src/react/server.ts',
	'src/react/router/index.ts',
	'src/react/router/browser.ts',
	'src/react/jsxRuntimeCompat.ts',
	'src/react/jsxDevRuntimeCompat.ts',
	'src/react/components/index.ts',
	'src/react/hooks/index.ts',
	'src/core/streamingSlotRegistrar.ts',
	'src/core/streamingSlotRegistry.ts',
	'src/svelte/index.ts',
	'src/svelte/browser.ts',
	'src/svelte/server.ts',
	'src/vue/index.ts',
	'src/vue/browser.ts',
	'src/vue/server.ts',
	'src/vue/components/index.ts',
	'src/vue/components/Image.ts'
];

const EXTERNALS = [
	'react',
	'react-dom',
	'react-router',
	'vue',
	'@vue/compiler-sfc',
	'vue/server-renderer',
	'svelte',
	'svelte/compiler',
	'svelte/server',
	'elysia',
	'elysia/*',
	'@elysia/openapi',
	'@elysia/server-timing',
	'@elysia/static',
	'@angular/compiler-cli',
	'@angular/compiler',
	'@angular/core',
	'@angular/common',
	'@angular/platform-browser',
	'@angular/platform-server',
	'@angular/ssr',
	'zone.js',
	'@tailwindcss/oxide',
	'@absolutejs/pwa',
	'@absolutejs/pwa/*',
	'typescript',
	'debug',
	'sharp',
	'@absolutejs/native-linux-x64',
	'@absolutejs/native-linux-arm64',
	'@absolutejs/native-darwin-x64',
	'@absolutejs/native-darwin-arm64'
];

/* The config server bundles React (for SSR) so it works even in
   Svelte/Vue/Angular-only projects that never installed React. ESLint and
   Elysia stay external — every consuming project already has them, and the
   user's ESLint must be the one that resolves their config + plugins. */
const CONFIG_SERVER_EXTERNALS = [
	...EXTERNALS.filter((dep) => dep !== 'react' && dep !== 'react-dom'),
	'eslint',
	'eslint/use-at-your-own-risk',
	'prettier'
];

const buildConfig = async () => {
	console.log('Building Absolute Config (server)...');
	const configServerBuild = await Bun.build({
		entrypoints: ['src/cli/config/server.ts'],
		external: CONFIG_SERVER_EXTERNALS,
		jsx: { development: false },
		outdir: join(DIST, 'cli', 'config'),
		target: 'bun'
	});

	if (!configServerBuild.success) {
		console.error('Absolute Config server build failed:');
		for (const log of configServerBuild.logs) console.error(log);
		process.exit(1);
	}

	console.log('Building Absolute Config (client)...');
	const configClientBuild = await Bun.build({
		define: { 'process.env.NODE_ENV': '"production"' },
		entrypoints: ['src/cli/config/client.tsx'],
		jsx: { development: false },
		minify: true,
		outdir: join(DIST, 'cli', 'config'),
		target: 'browser'
	});

	if (!configClientBuild.success) {
		console.error('Absolute Config client build failed:');
		for (const log of configClientBuild.logs) console.error(log);
		process.exit(1);
	}
};

const build = async () => {
	console.log('Cleaning dist/...');
	await rm(DIST, { force: true, recursive: true });

	console.log('Building server entry points...');
	const serverBuild = await Bun.build({
		entrypoints: SERVER_ENTRY_POINTS,
		external: EXTERNALS,
		jsx: { development: false },
		outdir: DIST,
		plugins: [lazyAngularCompilerPlugin],
		root: 'src',
		sourcemap: 'linked',
		target: 'bun'
	});

	if (!serverBuild.success) {
		console.error('Server build failed:');
		for (const log of serverBuild.logs) console.error(log);
		process.exit(1);
	}

	// Keep framework hydrators behind real browser chunks. The client runtime
	// dynamically imports each hydrator on first use, but bundling this entry
	// without splitting flattens those imports and leaves every optional peer
	// (`svelte`, `vue`, Angular, React) as a static import in client/index.js.
	// A React-only consumer would then need Svelte installed just to compile.
	console.log('Building split client runtime...');
	// `src/client/prefetch.ts` ships as its own `dist/client/prefetch.js`:
	// the raw-copied Svelte router (`dist/svelte/router/prefetchCache.ts`)
	// re-exports it by relative path at the user's build time, and it is the
	// public `@absolutejs/absolute/client/prefetch` subpath.
	const clientRuntimeBuild = await Bun.build({
		entrypoints: ['src/client/index.ts', 'src/client/prefetch.ts'],
		external: EXTERNALS,
		format: 'esm',
		naming: {
			chunk: 'client/chunks/[name]-[hash].[ext]',
			entry: '[dir]/[name].[ext]'
		},
		outdir: DIST,
		root: 'src',
		sourcemap: 'linked',
		splitting: true,
		target: 'browser'
	});

	if (!clientRuntimeBuild.success) {
		console.error('Split client runtime build failed:');
		for (const log of clientRuntimeBuild.logs) console.error(log);
		process.exit(1);
	}

	console.log('Building mobile shell modules...');
	const mobileShellBuild = await Bun.build({
		entrypoints: [
			'src/mobile/shellBootstrap.ts',
			'src/mobile/uiPrimitives.ts',
			'src/mobile/shellAuth.ts',
			'src/mobile/shellUpdate.ts',
			'src/mobile/shellExpoAuth.ts',
			'src/mobile/shellExpoSync.ts',
			'src/mobile/shellExpoDevices.ts',
			'src/mobile/shellSync.ts'
		],
		external: [
			'@absolutejs/auth/*',
			'@absolutejs/devices',
			'@absolutejs/devices-capacitor',
			'@absolutejs/devices-expo/*',
			'@absolutejs/devices/runtime',
			'@absolutejs/devices/web',
			'@absolutejs/sync/*',
			'@absolutejs/sync-expo/*',
			'@absolutejs/sync-capacitor',
			'@capacitor/*',
			'@capacitor-community/sqlite'
		],
		outdir: join(DIST, 'mobile'),
		target: 'browser'
	});

	if (!mobileShellBuild.success) {
		console.error('Mobile shell module build failed:');
		for (const log of mobileShellBuild.logs) console.error(log);
		process.exit(1);
	}
	const missingMobileShell = (
		await Promise.all(
			[
				'shellBootstrap.js',
				'uiPrimitives.js',
				'shellAuth.js',
				'shellUpdate.js',
				'shellExpoAuth.js',
				'shellExpoSync.js',
				'shellExpoDevices.js',
				'shellSync.js'
			].map(async (name) => ({
				exists: await Bun.file(join(DIST, 'mobile', name)).exists(),
				name
			}))
		)
	).find(({ exists }) => !exists);
	if (missingMobileShell)
		throw new Error(
			`Mobile shell build did not emit ${missingMobileShell.name}.`
		);

	console.log('Building image client (browser target)...');
	const imageBuild = await Bun.build({
		entrypoints: ['src/utils/imageClient.ts'],
		outdir: join(DIST, 'image-client'),
		target: 'browser'
	});

	if (!imageBuild.success) {
		console.error('Image client build failed:');
		for (const log of imageBuild.logs) console.error(log);
		process.exit(1);
	}

	console.log('Building React components (browser target)...');
	const reactBrowserBuild = await Bun.build({
		entrypoints: ['src/react/components/browser/index.ts'],
		external: [
			'react',
			'react-dom',
			'react/jsx-runtime',
			'react/jsx-dev-runtime'
		],
		jsx: { development: false },
		outdir: join(DIST, 'react', 'components', 'browser'),
		root: 'src/react/components/browser',
		target: 'browser'
	});

	if (!reactBrowserBuild.success) {
		console.error('React browser build failed:');
		for (const log of reactBrowserBuild.logs) console.error(log);
		process.exit(1);
	}

	console.log('Building CLI...');
	// The config server is built as a separate bundle below (it carries React
	// for SSR). The CLI imports it via a runtime-resolved specifier, so the
	// bundler leaves it out of this lean main chunk automatically.
	const cliBuild = await Bun.build({
		entrypoints: ['src/cli/index.ts'],
		external: EXTERNALS,
		outdir: join(DIST, 'cli'),
		target: 'bun'
	});

	if (!cliBuild.success) {
		console.error('CLI build failed:');
		for (const log of cliBuild.logs) console.error(log);
		process.exit(1);
	}

	console.log('Building remote Mac agent...');
	const remoteMacAgentBuild = await Bun.build({
		entrypoints: ['src/mobile/remoteMacAgentEntry.ts'],
		minify: true,
		outdir: join(DIST, 'mobile'),
		target: 'bun'
	});
	if (!remoteMacAgentBuild.success) {
		console.error('Remote Mac agent build failed:');
		for (const log of remoteMacAgentBuild.logs) console.error(log);
		process.exit(1);
	}

	console.log('Building dev server bootstrap...');
	const serverBootstrapBuild = await Bun.build({
		entrypoints: ['src/dev/serverBootstrap.ts'],
		outdir: join(DIST, 'dev'),
		target: 'bun'
	});
	if (!serverBootstrapBuild.success) {
		console.error('Dev server bootstrap build failed:');
		for (const log of serverBootstrapBuild.logs) console.error(log);
		process.exit(1);
	}

	await buildConfig();

	console.log('Generating type declarations...');
	// tsc emits .d.ts files even when reporting type errors (noEmitOnError defaults
	// to false). Don't let pre-existing type errors halt the rest of the build —
	// log them and continue so static assets and SFC declarations still copy over.
	try {
		await $`tsc --emitDeclarationOnly --project tsconfig.build.json`;
	} catch {
		console.warn(
			'tsc reported type errors; continuing with emitted .d.ts files'
		);
	}

	console.log('Copying static assets...');

	await copyPublishedDevClientSources();

	await mkdir(join(DIST, 'svelte', 'components'), { recursive: true });
	const svelteFiles = await readdir('src/svelte/components');
	await runSequentially(
		svelteFiles.filter((entry) => entry.endsWith('.svelte')),
		(file) =>
			cp(
				join('src', 'svelte', 'components', file),
				join(DIST, 'svelte', 'components', file)
			)
	);
	await copyPublishedSvelteRouterSources();
	await mkdir(join(DIST, 'vue', 'components'), { recursive: true });
	const vueFiles = await readdir('src/vue/components');
	await runSequentially(
		vueFiles.filter((entry) => entry.endsWith('.vue')),
		(file) =>
			cp(
				join('src', 'vue', 'components', file),
				join(DIST, 'vue', 'components', file)
			)
	);

	// Vendor the self-hosted htmx runtime so `absolute add htmx` / `absolute htmx`
	// can place it offline (resolved via import.meta.dir in both src and dist).
	await mkdir(join(DIST, 'cli', 'htmx'), { recursive: true });
	await cp(
		join('src', 'cli', 'htmx', 'htmx.min.js'),
		join(DIST, 'cli', 'htmx', 'htmx.min.js')
	);

	// Generate .d.ts files for SFC components so consumers get type safety
	console.log('Generating SFC type declarations...');
	await generateSfcDeclarations();

	console.log('Fixing Svelte entry points...');
	await fixSvelteEntryPoints();

	// Compile Angular components with partial compilation (ɵɵngDeclareComponent)
	// so they work in both AOT (via linker) and JIT (via runtime fallback)
	console.log('Compiling Angular components (partial)...');
	await compileAngularComponentsPartial();

	console.log('Verifying exports...');
	await verifyExports();

	console.log('Verifying published dev client imports...');
	await verifyPublishedDevClientImports();

	console.log('Build complete.');
};

const rewritePublishedDevClientSource = (
	content: string,
	relativePath: string
) => {
	const normalized = content
		.replaceAll('../.././../../types/', '../../../../types/')
		.replace(
			/((?:\.\.\/)+)types\/(client|globals|vue)/g,
			(_match, parents: string, target: string) => {
				const trimmed = parents.replace(/^\.\.\//, '');

				return `${trimmed}types/${target}`;
			}
		);

	const dir =
		dirname(relativePath) === '.'
			? ''
			: dirname(relativePath).replaceAll('\\', '/');
	const nestedDepth = dir ? dir.split('/').length : 0;
	const globalsPath = `${'../'.repeat(nestedDepth + 2)}types/globals`;
	const header = `import type {} from '${globalsPath}';\n`;

	return normalized.startsWith(header)
		? normalized
		: `${header}${normalized}`;
};

const copyPublishedDevClientEntry = async (
	entry: string,
	sourcePath: string,
	targetPath: string,
	relativePath: string
) => {
	const entryStat = await stat(sourcePath);
	if (entryStat.isDirectory()) {
		await copyPublishedDevClientDirectory(
			sourcePath,
			targetPath,
			relativePath
		);

		return;
	}

	if (!entry.endsWith('.ts')) {
		await cp(sourcePath, targetPath);

		return;
	}

	const sourceText = await readFile(sourcePath, 'utf8');
	const rewritten = rewritePublishedDevClientSource(sourceText, relativePath);
	await writeFile(targetPath, rewritten);
};

const copyPublishedDevClientDirectory = async (
	sourceDir: string,
	targetDir: string,
	relativeDir = ''
) => {
	await mkdir(targetDir, { recursive: true });
	const entries = await readdir(sourceDir);
	await runSequentially(entries, async (entry) => {
		const sourcePath = join(sourceDir, entry);
		const targetPath = join(targetDir, entry);
		const relativePath = relativeDir ? join(relativeDir, entry) : entry;
		await copyPublishedDevClientEntry(
			entry,
			sourcePath,
			targetPath,
			relativePath
		);
	});
};

const fixSvelteEntryPoint = async (entryPath: string) => {
	const source = await readFile(entryPath, 'utf8');
	const replacements: Array<[RegExp, string]> = [
		[
			/^var Island_default = ['"][^'"]+\.svelte['"];$/m,
			'import Island_default from "./components/Island.svelte";'
		],
		[
			/^var AwaitSlot_default = ['"][^'"]+\.svelte['"];$/m,
			'import AwaitSlot_default from "./components/AwaitSlot.svelte";'
		],
		[
			/^var StreamSlot_default = ['"][^'"]+\.svelte['"];$/m,
			'import StreamSlot_default from "./components/StreamSlot.svelte";'
		]
	];

	let nextSource = source;
	let changed = false;
	for (const [pattern, replacement] of replacements) {
		if (!pattern.test(nextSource)) continue;
		nextSource = nextSource.replace(pattern, replacement);
		changed = true;
	}

	if (!changed) return;

	await writeFile(entryPath, nextSource);
};

const fixSvelteEntryPoints = async () => {
	await fixSvelteEntryPoint(join(DIST, 'svelte', 'index.js'));
	await fixSvelteEntryPoint(join(DIST, 'svelte', 'browser.js'));
};

const PUBLISHED_AMBIENT_TYPE_FILES = ['globals.d.ts', 'style-module-shim.d.ts'];

const SVELTE_ROUTER_PUBLIC_TYPE_FILES = ['svelteRouter.ts'];

const rewriteSvelteRouterSource = (content: string) =>
	// Two mechanical rewrites:
	// 1. types/ path depth differs between src layout (3 ups) and dist
	//    layout (2 ups, since dist/types/ sits closer to dist/svelte/).
	// 2. The source `page.svelte.ts` rune module is compiled and shipped
	//    as `page.js` in dist. compileSvelte's resolver matches anything
	//    ending in `.svelte`, `.svelte.ts`, or `.svelte.js`, which would
	//    cause my pre-compiled JS to be re-fed through Svelte. Renaming
	//    the output to plain `.js` and rewriting the import path keeps
	//    user-side compileSvelte from re-touching it.
	content
		.replaceAll('../../../types/', '../../types/')
		.replaceAll("from './page.svelte'", "from './page.js'")
		.replaceAll('from "./page.svelte"', 'from "./page.js"');

const copyPublishedSvelteRouterSources = async () => {
	const sourceDir = join('src', 'svelte', 'router');
	const targetDir = join(DIST, 'svelte', 'router');
	await mkdir(targetDir, { recursive: true });

	// Svelte 5 rune modules (`*.svelte.ts`) need preprocessing by Svelte's
	// compiler — Bun's native TS handler doesn't recognise $state /
	// $derived. Pre-compile them here so consumers see plain JS that
	// boots the rune runtime correctly.
	const { compileModule } = await import('svelte/compiler');

	const entries = await readdir(sourceDir);
	await runSequentially(entries, async (entry) => {
		const sourcePath = join(sourceDir, entry);
		const targetPath = join(targetDir, entry);

		if (entry.endsWith('.svelte')) {
			// Same rewrite the .ts files get: `./page.svelte` →
			// `./page.js` so the component's compiled-by-user output
			// imports the pre-compiled rune module instead of looking
			// for a non-existent `.svelte` file in dist.
			const sourceText = await readFile(sourcePath, 'utf8');
			await writeFile(targetPath, rewriteSvelteRouterSource(sourceText));

			return;
		}

		if (entry.endsWith('.svelte.d.ts')) {
			const sourceText = await readFile(sourcePath, 'utf8');
			await writeFile(targetPath, rewriteSvelteRouterSource(sourceText));

			return;
		}

		if (entry.endsWith('.svelte.ts')) {
			// Compile the rune module to plain JS. Svelte's compileModule
			// runs an Acorn parse that doesn't understand TS — strip types
			// with Bun.Transpiler first, then hand the JS to Svelte for
			// rune lowering. Output as `.svelte.js` so Bun's resolver
			// picks the compiled file when source code imports
			// `./page.svelte`.
			const sourceText = await readFile(sourcePath, 'utf8');
			const rewritten = rewriteSvelteRouterSource(sourceText);
			const transpiler = new Bun.Transpiler({ loader: 'ts' });
			const stripped = transpiler.transformSync(rewritten);
			const compiled = compileModule(stripped, {
				dev: false,
				filename: entry,
				generate: 'client'
			});
			const compiledPath = targetPath.replace(/\.svelte\.ts$/, '.js');
			await writeFile(compiledPath, compiled.js.code);

			// Mirror the tsc-emitted `.d.ts` next to the compiled JS so
			// TypeScript can resolve types from `./page.js` imports.
			const tscDtsPath = join(
				DIST,
				'src',
				'svelte',
				'router',
				entry.replace(/\.svelte\.ts$/, '.svelte.d.ts')
			);
			const dtsTargetPath = compiledPath.replace(/\.js$/, '.d.ts');
			try {
				const dtsText = await readFile(tscDtsPath, 'utf8');
				await writeFile(
					dtsTargetPath,
					rewriteSvelteRouterSource(dtsText)
				);
			} catch {
				// tsc didn't emit one (likely a previous failure) — skip
				// rather than break the whole build. Consumers without
				// TypeScript still work; svelte-check will surface the
				// missing-types error to anyone who needs it.
			}

			return;
		}

		if (entry.endsWith('.ts')) {
			const sourceText = await readFile(sourcePath, 'utf8');
			await writeFile(targetPath, rewriteSvelteRouterSource(sourceText));
		}
	});

	// Public router types live in types/ at the source layout but need to
	// be available alongside the other ambient types under dist/types/ so
	// the rewritten relative imports inside dist/svelte/router/ resolve.
	await mkdir(join(DIST, 'types'), { recursive: true });
	await runSequentially(SVELTE_ROUTER_PUBLIC_TYPE_FILES, (file) =>
		cp(join('types', file), join(DIST, 'types', file))
	);
};

const copyPublishedDevClientSources = async () => {
	await mkdir(join(DIST, 'dev'), { recursive: true });
	await copyPublishedDevClientDirectory(
		join('src', 'dev', 'client'),
		join(DIST, 'dev', 'client')
	);
	await mkdir(join(DIST, 'types'), { recursive: true });
	await runSequentially(PUBLISHED_AMBIENT_TYPE_FILES, (file) =>
		cp(join('types', file), join(DIST, 'types', file))
	);
	// Ship `src/angular/hmrPreserveCore.ts` as raw TS so the dev client
	// (which is also shipped raw and resolved at user-app build time) can
	// import it via `../../../angular/hmrPreserveCore`. The angular
	// submodule's *bundled* output (`dist/angular/index.js`) inlines the
	// same source, so user code that imports `@absolutejs/absolute/angular`
	// gets the bundled version. The two consumers share state via
	// `globalThis`, so the duplication on disk doesn't cause divergence.
	// Plain `cp` without rewriting because this file references no
	// ambient globals or rewrite-targeted paths.
	await mkdir(join(DIST, 'angular'), { recursive: true });
	await cp(
		join('src', 'angular', 'hmrPreserveCore.ts'),
		join(DIST, 'angular', 'hmrPreserveCore.ts')
	);
	// The HMR client installs the mobile preview bridge from
	// `../../mobile/mobilePreviewClient`, so that file ships raw beside the
	// mobile shell bundles for the same reason. It imports only published
	// `@absolutejs/*` packages and touches `globalThis` through `Reflect`,
	// so it needs neither the ambient-globals header nor path rewriting.
	await mkdir(join(DIST, 'mobile'), { recursive: true });
	await cp(
		join('src', 'mobile', 'mobilePreviewClient.ts'),
		join(DIST, 'mobile', 'mobilePreviewClient.ts')
	);
};

const RELATIVE_IMPORT_PATTERN =
	/\b(?:import|export)\b[^'"]*?\bfrom\s*['"](\.[^'"]+)['"]|\bimport\s*['"](\.[^'"]+)['"]/g;
const RAW_SOURCE_RESOLUTIONS = [
	'',
	'.ts',
	'.tsx',
	'.d.ts',
	'.js',
	'/index.ts',
	'/index.js'
];

const listRawSources = async (directory: string): Promise<string[]> => {
	const entries = await readdir(directory, { withFileTypes: true });
	const nested = await Promise.all(
		entries.map(async (entry) => {
			const entryPath = join(directory, entry.name);
			if (entry.isDirectory()) return listRawSources(entryPath);

			return entry.name.endsWith('.ts') ? [entryPath] : [];
		})
	);

	return nested.flat();
};

const rawSourceResolves = async (base: string) => {
	const candidates = await Promise.all(
		RAW_SOURCE_RESOLUTIONS.map((suffix) =>
			stat(`${base}${suffix}`)
				.then((info) => info.isFile())
				.catch(() => false)
		)
	);

	return candidates.some(Boolean);
};

/**
 * The dev client ships as raw TypeScript that the user's app resolves at its
 * own build time, so every relative import must point at a file that is
 * also in `dist`. A missing one fails the user's client build (seen as
 * "Could not resolve" from `hmrClient.ts`), not ours — so check here.
 */
const verifyPublishedDevClientImports = async () => {
	const sources = await listRawSources(join(DIST, 'dev', 'client'));
	const missing: string[] = [];
	await runSequentially(sources, async (file) => {
		const content = await readFile(file, 'utf8');
		const targets = [...content.matchAll(RELATIVE_IMPORT_PATTERN)]
			.map((match) => match[1] ?? match[2])
			.filter((target): target is string => typeof target === 'string');
		await runSequentially(targets, async (target) => {
			if (!(await rawSourceResolves(join(dirname(file), target))))
				missing.push(`${file} → ${target}`);
		});
	});

	if (missing.length > 0) {
		console.error(
			'\nPublished dev client verification failed! Unresolvable imports:'
		);
		for (const msg of missing) console.error(`  ${msg}`);
		throw new Error('Published dev client has unresolvable imports');
	}
};

const buildSvelteDts = (name: string, propsType: string | undefined) => {
	if (propsType === 'ImageProps') {
		return `import type { ImageProps } from '../../types/image';\nimport { SvelteComponent } from 'svelte';\ndeclare const __propDef: { props: ImageProps };\ntype Props = typeof __propDef.props;\nexport default class ${name} extends SvelteComponent<Props> {}\n`;
	}
	if (propsType) {
		return `import type { ${propsType} } from '../../types/metadata';\nimport { SvelteComponent } from 'svelte';\ndeclare const __propDef: { props: ${propsType} };\ntype Props = typeof __propDef.props;\nexport default class ${name} extends SvelteComponent<Props> {}\n`;
	}

	return `import { SvelteComponent } from 'svelte';\nexport default class ${name} extends SvelteComponent {}\n`;
};

const buildVueDts = (name: string, hasImageProps: boolean) => {
	if (name === 'Image' || hasImageProps) {
		return `import type { ImageProps } from '../../types/image';\nimport { DefineComponent } from 'vue';\ndeclare const _default: DefineComponent<ImageProps>;\nexport default _default;\n`;
	}

	return `import { DefineComponent } from 'vue';\ndeclare const _default: DefineComponent;\nexport default _default;\n`;
};

const generateSfcDeclarations = async () => {
	// Svelte component declarations
	const svelteComponentDir = join(DIST, 'svelte', 'components');
	const svelteFiles = await readdir(svelteComponentDir);
	await runSequentially(
		svelteFiles.filter((entry) => entry.endsWith('.svelte')),
		async (file) => {
			const content = await Bun.file(
				join(svelteComponentDir, file)
			).text();
			const propsMatch = content.match(/\}:\s*(\w+)\s*=\s*\$props\(\)/);
			const propsType = propsMatch?.[1];
			const name = file.replace(/\.svelte$/, '');

			const dts = buildSvelteDts(name, propsType);
			await writeFile(join(svelteComponentDir, `${file}.d.ts`), dts);
		}
	);

	// Vue component declarations
	const vueComponentDir = join(DIST, 'vue', 'components');
	const vueFiles = await readdir(vueComponentDir);
	await runSequentially(
		vueFiles.filter((entry) => entry.endsWith('.vue')),
		async (file) => {
			const content = await Bun.file(join(vueComponentDir, file)).text();
			const name = file.replace(/\.vue$/, '');

			// Check if it uses defineProps<ImageProps> or inline props
			const hasImageProps =
				content.includes('ImageProps') ||
				content.includes('defineProps<{');
			const dts = buildVueDts(name, hasImageProps);
			await writeFile(join(vueComponentDir, `${file}.d.ts`), dts);
		}
	);
};

const addJsExtensions = (content: string) =>
	content.replace(
		/from\s+(['"])(\.\.?\/[^'"]+)(\1)/g,
		(match, quote, path) => {
			if (!path.match(/\.(js|ts|mjs|cjs)$/)) {
				return `from ${quote}${path}.js${quote}`;
			}

			return match;
		}
	);

const logAngularErrorsAndExit = (errors: ts.Diagnostic[]) => {
	console.error('Angular partial compilation errors:');
	for (const diag of errors)
		console.error(ts.flattenDiagnosticMessageText(diag.messageText, '\n'));
	process.exit(1);
};

const compileAngularComponentsPartial = async () => {
	const { readConfiguration, performCompilation, EmitFlags } = await import(
		'@angular/compiler-cli'
	);

	const finalDir = join(DIST, 'angular', 'components');
	const finalTypesDir = join(DIST, 'src', 'angular', 'components');
	await mkdir(finalDir, { recursive: true });
	await mkdir(finalTypesDir, { recursive: true });

	// Use a unique temp output dir outside dist/ so parallel build calls cannot
	// remove each other's Angular partial compilation workspace.
	const tmpDir = await mkdtemp('.angular-partial-tmp-');
	const outDir = join(tmpDir, 'out');
	const srcDir = join(tmpDir, 'src');
	try {
		await mkdir(outDir, { recursive: true });
		await mkdir(srcDir, { recursive: true });

		const srcFiles = await readdir('src/angular/components');
		await runSequentially(
			srcFiles.filter((entry) => entry.endsWith('.ts')),
			async (file) => {
				let content = await Bun.file(
					join('src', 'angular', 'components', file)
				).text();
				content = content.replace(
					/from\s+(['"])\.\.\/\.\.\/utils\/imageProcessing['"]/g,
					'from $1@absolutejs/absolute/image$1'
				);
				content = content.replace(
					/from\s+(['"])\.\.\/\.\.\/core\/streamingSlotRegistry['"]/g,
					'from $1./core/streamingSlotRegistry$1'
				);
				content = content.replace(
					/from\s+(['"])\.\.\/\.\.\/core\/streamingSlotRegistrar['"]/g,
					'from $1./core/streamingSlotRegistrar$1'
				);
				await Bun.write(join(srcDir, file), content);
			}
		);

		await mkdir(join(srcDir, 'core'), { recursive: true });
		await mkdir(join(srcDir, 'utils'), { recursive: true });
		await mkdir(join(srcDir, 'client'), { recursive: true });
		await cp(join('src', 'constants.ts'), join(srcDir, 'constants.ts'));
		await cp(
			join('src', 'core', 'streamingSlotRegistry.ts'),
			join(srcDir, 'core', 'streamingSlotRegistry.ts')
		);
		await cp(
			join('src', 'core', 'streamingSlotRegistrar.ts'),
			join(srcDir, 'core', 'streamingSlotRegistrar.ts')
		);
		await cp(
			join('src', 'utils', 'streamingSlots.ts'),
			join(srcDir, 'utils', 'streamingSlots.ts')
		);
		await cp(
			join('src', 'utils', 'escapeScriptContent.ts'),
			join(srcDir, 'utils', 'escapeScriptContent.ts')
		);
		await cp(
			join('src', 'client', 'streamSwap.ts'),
			join(srcDir, 'client', 'streamSwap.ts')
		);

		const config = readConfiguration('./tsconfig.json');
		const tsOptions: ts.CompilerOptions = {
			declaration: true,
			emitDecoratorMetadata: true,
			experimentalDecorators: true,
			module: ts.ModuleKind.ESNext,
			moduleResolution: ts.ModuleResolutionKind.Bundler,
			newLine: ts.NewLineKind.LineFeed,
			outDir,
			rootDir: resolve('.'),
			skipLibCheck: true,
			suppressOutputPathCheck: true,
			target: ts.ScriptTarget.ES2022
		};

		const options: AngularCompilerOptions & { compilationMode: 'partial' } =
			{
				...config.options,
				...tsOptions,
				compilationMode: 'partial' as const
			};

		const host = ts.createCompilerHost(tsOptions);

		// Capture only files emitted from our source dir (not external deps like imageClient)
		const emitted: Record<string, string> = {};
		const resolvedSrcInOut = resolve(
			outDir,
			relative(resolve('.'), resolve(srcDir))
		);
		host.writeFile = (fileName, text) => {
			const absFileName = resolve(fileName);
			if (!absFileName.startsWith(resolvedSrcInOut)) return;
			const rel = absFileName.substring(resolvedSrcInOut.length + 1);
			emitted[rel] = text;
		};

		// Copy ambient global types into the temp tree so .ts files referencing
		// window.__ABS_* (and other globals declared in types/globals.d.ts) compile.
		const tmpTypesDir = join(tmpDir, 'types');
		await mkdir(tmpTypesDir, { recursive: true });
		await cp('types/globals.d.ts', join(tmpTypesDir, 'globals.d.ts'));

		const rootNames = srcFiles
			.filter((entry) => entry.endsWith('.ts'))
			.map((entry) => resolve(srcDir, entry));
		rootNames.push(resolve(tmpTypesDir, 'globals.d.ts'));

		const { diagnostics } = performCompilation({
			emitFlags: EmitFlags.Default,
			host,
			options,
			rootNames
		});

		// Only fail the build on errors that originate from the angular component
		// sources we copied into the temp dir. Errors in transitively imported
		// files (svelte/vue type defs, etc.) are pre-existing and tolerated.
		const resolvedSrcDir = resolve(srcDir);
		const errors = diagnostics.filter(
			(diag: ts.Diagnostic) =>
				diag.category === ts.DiagnosticCategory.Error &&
				diag.file?.fileName?.startsWith(resolvedSrcDir)
		);
		if (errors.length > 0) logAngularErrorsAndExit(errors);

		// Copy emitted JS files to final dir, adding .js extensions to relative imports
		const resolveOutputDir = (fileName: string) => {
			if (fileName.endsWith('.js')) {
				return finalDir;
			}

			if (fileName.endsWith('.d.ts')) {
				return finalTypesDir;
			}

			return null;
		};
		const writeEmittedArtifact = async (
			fileName: string,
			content: string
		) => {
			const outputDir = resolveOutputDir(fileName);
			if (!outputDir) {
				return;
			}

			const processed = addJsExtensions(content);
			await writeFile(join(outputDir, fileName), processed);
		};

		await runSequentially(
			Object.entries(emitted),
			async ([fileName, content]) => {
				if (fileName.includes('/')) return;
				await writeEmittedArtifact(fileName, content);
			}
		);

		await Bun.build({
			entrypoints: [
				resolve(srcDir, 'core', 'streamingSlotRegistry.ts'),
				resolve(srcDir, 'core', 'streamingSlotRegistrar.ts')
			],
			external: ['node:async_hooks'],
			format: 'esm',
			minify: false,
			outdir: resolve(finalDir, 'core'),
			sourcemap: false,
			target: 'bun'
		});
	} finally {
		await rm(tmpDir, { force: true, recursive: true }).catch(() => {
			/* temp dir already gone */
		});
	}
};

const verifyExports = async () => {
	const pkg = await Bun.file('package.json').json();
	const exports: Record<string, { import?: string; types?: string }> =
		pkg.exports ?? {};
	const missing: string[] = [];

	await runSequentially(Object.entries(exports), async ([key, value]) => {
		if (!value.import) return;
		const importPath = value.import.replace('./', '');
		const importFile = Bun.file(importPath);
		if (!(await importFile.exists()))
			missing.push(`${key} → ${value.import}`);
	});

	if (pkg.main) {
		const mainPath = pkg.main.replace('./', '');
		const mainFile = Bun.file(mainPath);
		if (!(await mainFile.exists())) missing.push(`main → ${pkg.main}`);
	}

	if (missing.length > 0) {
		console.error('\nExport verification failed! Missing files:');
		for (const msg of missing) console.error(`  ${msg}`);
		process.exit(1);
	}
};

withBuildLock(build);
