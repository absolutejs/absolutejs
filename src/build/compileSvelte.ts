import { BASE_36_RADIX } from '../constants';
import { existsSync } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import {
	dirname,
	join,
	basename,
	extname,
	resolve,
	relative,
	sep
} from 'node:path';
import { env } from 'node:process';
import { write, file, Transpiler } from 'bun';
const resolveDevClientDir = () => {
	const projectRoot = process.cwd();
	const fromSource = resolve(import.meta.dir, '../dev/client');

	if (existsSync(fromSource) && fromSource.startsWith(projectRoot)) {
		return fromSource;
	}

	const fromNodeModules = resolve(
		projectRoot,
		'node_modules/@absolutejs/absolute/dist/dev/client'
	);
	if (existsSync(fromNodeModules)) return fromNodeModules;

	return resolve(import.meta.dir, './dev/client');
};

const devClientDir = resolveDevClientDir();

const hmrClientPath = join(devClientDir, 'hmrClient.ts').replace(/\\/g, '/');

type Built = { ssr: string; client: string };
type Cache = Map<string, Built>;

// Persistent cache across HMR cycles — avoids recompiling unchanged Svelte components
const persistentCache: Cache = new Map();

// Content hash cache to detect unchanged source files
const sourceHashCache = new Map<string, string>();

export const clearSvelteCompilerCache = () => {
	persistentCache.clear();
	sourceHashCache.clear();
};

const transpiler = new Transpiler({ loader: 'ts', target: 'browser' });

const exists = async (path: string) => {
	try {
		await stat(path);

		return true;
	} catch {
		return false;
	}
};

const resolveSvelte = async (spec: string, from: string) => {
	const basePath = resolve(dirname(from), spec);
	const explicit = /\.(svelte|svelte\.(?:ts|js))$/.test(basePath);

	if (!explicit) {
		const extensions = ['.svelte', '.svelte.ts', '.svelte.js'];
		const paths = extensions.map((ext) => `${basePath}${ext}`);
		const checks = await Promise.all(paths.map(exists));
		const match = paths.find((_, index) => checks[index]);

		return match ?? null;
	}

	if (await exists(basePath)) return basePath;
	if (!basePath.endsWith('.svelte')) return null;

	const tsPath = `${basePath}.ts`;
	if (await exists(tsPath)) return tsPath;

	const jsPath = `${basePath}.js`;
	if (await exists(jsPath)) return jsPath;

	return null;
};

export const compileSvelte = async (
	entryPoints: string[],
	svelteRoot: string,
	cache: Cache = new Map(),
	isDev = false
) => {
	const { compile, compileModule, preprocess } = await import(
		'svelte/compiler'
	);

	const generatedDir = join(svelteRoot, 'generated');
	const clientDir = join(generatedDir, 'client');
	const indexDir = join(generatedDir, 'indexes');
	const serverDir = join(generatedDir, 'server');

	await Promise.all(
		[clientDir, indexDir, serverDir].map((dir) =>
			mkdir(dir, { recursive: true })
		)
	);

	const dev = env.NODE_ENV !== 'production';

	const build = async (src: string) => {
		const memoized = cache.get(src);
		if (memoized) return memoized;

		const raw = await file(src).text();

		// Check if source is unchanged since last compilation
		const contentHash = Bun.hash(raw).toString(BASE_36_RADIX);
		const prevHash = sourceHashCache.get(src);
		const persistent = persistentCache.get(src);

		if (prevHash === contentHash && persistent) {
			cache.set(src, persistent);

			return persistent;
		}

		sourceHashCache.set(src, contentHash);
		const isModule =
			src.endsWith('.svelte.ts') || src.endsWith('.svelte.js');
		const preprocessed = isModule ? raw : (await preprocess(raw, {})).code;
		const transpiled =
			src.endsWith('.ts') || src.endsWith('.svelte.ts')
				? transpiler.transformSync(preprocessed)
				: preprocessed;

		const rawRel = dirname(relative(svelteRoot, src)).replace(/\\/g, '/');
		// When a source file lives outside svelteRoot (e.g. src/svelte/components/Head.svelte
		// imported from example/svelte/pages/), the relative path starts with "../".
		// Use cwd-relative path so compiled output stays inside generated/.
		const relDir = rawRel.startsWith('..')
			? `_ext/${relative(process.cwd(), dirname(src)).replace(/\\/g, '/')}`
			: rawRel;
		const baseName = basename(src).replace(/\.svelte(\.(ts|js))?$/, '');

		const importPaths = Array.from(
			transpiled.matchAll(/from\s+['"]([^'"]+)['"]/g)
		)
			.map((match) => match[1])
			.filter((path): path is string => path !== undefined);

		const resolvedImports = await Promise.all(
			importPaths.map((importPath) => resolveSvelte(importPath, src))
		);
		const childSources = resolvedImports.filter(
			(path): path is string => path !== null
		);
		await Promise.all(childSources.map((child) => build(child)));

		// Build a map of original import specifiers (with .svelte→.js applied) to
		// the correct relative path from this file's compiled output to the child's
		// compiled output. Only needed for children outside svelteRoot whose output
		// lands in _ext/.
		const externalRewrites = new Map<string, { server: string; client: string }>();

		for (let idx = 0; idx < importPaths.length; idx++) {
			const resolved = resolvedImports[idx];
			if (!resolved) continue;

			const childRel = relative(svelteRoot, resolved).replace(/\\/g, '/');
			if (!childRel.startsWith('..')) continue;

			const childBuilt = cache.get(resolved);
			if (!childBuilt) continue;

			const rawSpec = importPaths[idx];
			if (!rawSpec) continue;

			const origSpec = rawSpec.replace(/\.svelte(?:\.(?:ts|js))?$/, '.js');

			const ssrOutputDir = dirname(join(serverDir, relDir, `${baseName}.js`));
			const clientOutputDir = dirname(join(clientDir, relDir, `${baseName}.js`));

			const toServer = relative(ssrOutputDir, childBuilt.ssr).replace(/\\/g, '/');
			const toClient = relative(clientOutputDir, childBuilt.client).replace(/\\/g, '/');

			externalRewrites.set(origSpec, {
				client: toClient.startsWith('.') ? toClient : `./${toClient}`,
				server: toServer.startsWith('.') ? toServer : `./${toServer}`
			});
		}

		const rewriteExternalImports = (code: string, mode: 'server' | 'client') => {
			let result = code;

			for (const [origSpec, paths] of externalRewrites) {
				const target = mode === 'server' ? paths.server : paths.client;
				result = result.replace(origSpec, target);
			}

			return result;
		};

		const generate = (mode: 'server' | 'client') => {
			const compiled = isModule
				? compileModule(transpiled, {
						dev: mode === 'client' && dev,
						filename: src
					}).js.code
				: compile(transpiled, {
						css: 'injected',
						dev: mode === 'client' && dev,
						filename: src,
						generate: mode,
						hmr: mode === 'client' && isDev
					}).js.code;
			let code = compiled.replace(
				/\.svelte(?:\.(?:ts|js))?(['"])/g,
				'.js$1'
			);
			// For client dev builds: replace import.meta.hot with our
			// accept registry so $.hmr() wrapper + accept callback are
			// both active. This enables component-level HMR swaps.
			if (mode === 'client' && isDev) {
				const moduleKey = `/@src/${relative(
					process.cwd(),
					src
				).replace(/\\/g, '/')}`;
				code = code.replace(
					/if\s*\(import\.meta\.hot\)\s*\{/,
					`if (typeof window !== "undefined") {\n` +
						`  if (!window.__SVELTE_HMR_ACCEPT__) window.__SVELTE_HMR_ACCEPT__ = {};\n` +
						`  var __hmr_accept = function(cb) { window.__SVELTE_HMR_ACCEPT__[${JSON.stringify(moduleKey)}] = cb; };`
				);
				code = code.replace(
					/import\.meta\.hot\.accept\(/g,
					'__hmr_accept('
				);

				// State preservation is handled at runtime by the patched
				// $.hmr() function (collect_state/restore_state). No
				// State preservation handled by Svelte's $.hmr() runtime.
			}

			return code;
		};

		// Rewrite relative imports that escape the framework root.
		// Source file is at svelteRoot/<relDir>/file.svelte, but compiled
		// output is at svelteRoot/generated/{mode}/<relDir>/file.js —
		// 2 extra directory levels. Imports going above svelteRoot need
		// ../../ prepended so they resolve to the same target.
		const relDepth = relDir === '.' ? 0 : relDir.split('/').length;
		const adjustImports = (code: string) =>
			code.replace(
				/(from\s+['"])(\.\.\/(?:\.\.\/)*)/g,
				(_, prefix, dots) => {
					const upCount = dots.split('/').length - 1;
					if (upCount <= relDepth) return `${prefix}${dots}`;

					return `${prefix}../../${dots}`;
				}
			);

		const ssrPath = join(serverDir, relDir, `${baseName}.js`);
		const clientPath = join(clientDir, relDir, `${baseName}.js`);

		await Promise.all([
			mkdir(dirname(ssrPath), { recursive: true }),
			mkdir(dirname(clientPath), { recursive: true })
		]);

		if (isModule) {
			const bundle = adjustImports(rewriteExternalImports(generate('client'), 'client'));
			await Promise.all([
				write(ssrPath, bundle),
				write(clientPath, bundle)
			]);
		} else {
			const serverBundle = adjustImports(rewriteExternalImports(generate('server'), 'server'));
			const clientBundle = adjustImports(rewriteExternalImports(generate('client'), 'client'));
			await Promise.all([
				write(ssrPath, serverBundle),
				write(clientPath, clientBundle)
			]);
		}

		const built: Built = { client: clientPath, ssr: ssrPath };
		cache.set(src, built);
		persistentCache.set(src, built);

		return built;
	};

	const roots = await Promise.all(entryPoints.map(build));

	await Promise.all(
		roots.map(async ({ client }) => {
			const relClientDir = dirname(relative(clientDir, client));
			const name = basename(client, extname(client));
			const indexPath = join(indexDir, relClientDir, `${name}.js`);
			const importRaw = relative(dirname(indexPath), client)
				.split(sep)
				.join('/');
			const importPath =
				importRaw.startsWith('.') || importRaw.startsWith('/')
					? importRaw
					: `./${importRaw}`;
			const hmrImports = isDev
				? `window.__HMR_FRAMEWORK__ = "svelte";\nimport "${hmrClientPath}";\n`
				: '';
			const bootstrap = `${hmrImports}import Component from "${importPath}";
import { hydrate, mount, unmount } from "svelte";

var initialProps = (typeof window !== "undefined" && window.__INITIAL_PROPS__) ? window.__INITIAL_PROPS__ : {};
var isHMR = typeof window !== "undefined" && window.__SVELTE_COMPONENT__ !== undefined;
var isSsrDirty = typeof window !== "undefined" && window.__SSR_DIRTY__;
var component;

if (isHMR) {
  var preservedState = window.__HMR_PRESERVED_STATE__;
  if (!preservedState) {
    try {
      var stored = sessionStorage.getItem("__SVELTE_HMR_STATE__");
      if (stored) preservedState = JSON.parse(stored);
    } catch (err) { /* ignore */ }
  }
  var mergedProps = (preservedState && Object.keys(preservedState).length > 0) ? Object.assign({}, initialProps, preservedState) : initialProps;
  if (typeof window.__SVELTE_UNMOUNT__ === "function") {
    try { window.__SVELTE_UNMOUNT__(); } catch (err) { /* ignore */ }
  }
  component = mount(Component, { target: document.body, props: mergedProps });
  window.__HMR_PRESERVED_STATE__ = undefined;
} else if (isSsrDirty) {
  component = mount(Component, { target: document.body, props: initialProps });
} else {
  component = hydrate(Component, { target: document.body, props: initialProps });
}

if (typeof window !== "undefined") {
  window.__SVELTE_COMPONENT__ = component;
  window.__SVELTE_UNMOUNT__ = function() { unmount(component); };
}`;

			await mkdir(dirname(indexPath), { recursive: true });

			return write(indexPath, bootstrap);
		})
	);

	return {
		// Actual client component paths (for official HMR module imports)
		svelteClientPaths: roots.map(({ client }) => client),
		// Index paths (entry points for hydration)
		svelteIndexPaths: roots.map(({ client }) => {
			const rel = dirname(relative(clientDir, client));

			return join(indexDir, rel, basename(client));
		}),
		svelteServerPaths: roots.map(({ ssr }) => ssr)
	};
};
