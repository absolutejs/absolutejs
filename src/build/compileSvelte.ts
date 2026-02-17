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
import { compile, compileModule, preprocess } from 'svelte/compiler';

const hmrClientPath = resolve(
	import.meta.dir,
	'../dev/client/hmrClient.ts'
).replace(/\\/g, '/');

type Built = { ssr: string; client: string };
type Cache = Map<string, Built>;

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
	const compiledRoot = join(svelteRoot, 'compiled');
	const clientDir = join(compiledRoot, 'client');
	const indexDir = join(compiledRoot, 'indexes');
	const pagesDir = join(compiledRoot, 'pages');

	await Promise.all(
		[clientDir, indexDir, pagesDir].map((dir) =>
			mkdir(dir, { recursive: true })
		)
	);

	const dev = env.NODE_ENV !== 'production';

	const build = async (src: string) => {
		const memoized = cache.get(src);
		if (memoized) return memoized;

		const raw = await file(src).text();
		const isModule =
			src.endsWith('.svelte.ts') || src.endsWith('.svelte.js');
		const preprocessed = isModule ? raw : (await preprocess(raw, {})).code;
		const transpiled =
			src.endsWith('.ts') || src.endsWith('.svelte.ts')
				? transpiler.transformSync(preprocessed)
				: preprocessed;

		const relDir = dirname(relative(svelteRoot, src)).replace(/\\/g, '/');
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

		const generate = (mode: 'server' | 'client') =>
			(isModule
				? compileModule(transpiled, { dev, filename: src }).js.code
				: compile(transpiled, {
						css: 'injected',
						dev,
						filename: src,
						generate: mode
					}).js.code
			).replace(/\.svelte(?:\.(?:ts|js))?(['"])/g, '.js$1');

		const ssrPath = join(pagesDir, relDir, `${baseName}.js`);
		const clientPath = join(clientDir, relDir, `${baseName}.js`);

		await Promise.all([
			mkdir(dirname(ssrPath), { recursive: true }),
			mkdir(dirname(clientPath), { recursive: true })
		]);

		if (isModule) {
			const bundle = generate('client');
			await Promise.all([write(ssrPath, bundle), write(clientPath, bundle)]);
		} else {
			const serverBundle = generate('server');
			const clientBundle = generate('client');
			await Promise.all([
				write(ssrPath, serverBundle),
				write(clientPath, clientBundle)
			]);
		}

		const built: Built = { client: clientPath, ssr: ssrPath };
		cache.set(src, built);

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
var component;

if (isHMR) {
  if (typeof window.__SVELTE_UNMOUNT__ === "function") {
    try { window.__SVELTE_UNMOUNT__(); } catch (err) { console.warn("[HMR] unmount error:", err); }
  }
  var preservedState = window.__HMR_PRESERVED_STATE__;
  if (!preservedState) {
    try {
      var stored = sessionStorage.getItem("__SVELTE_HMR_STATE__");
      if (stored) preservedState = JSON.parse(stored);
    } catch (err) { /* ignore */ }
  }
  var mergedProps = preservedState ? Object.assign({}, initialProps, preservedState) : initialProps;
  component = mount(Component, { target: document.body, props: mergedProps });
  window.__HMR_PRESERVED_STATE__ = undefined;
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
		// Index paths (entry points for hydration)
		svelteIndexPaths: roots.map(({ client }) => {
			const rel = dirname(relative(clientDir, client));
			return join(indexDir, rel, basename(client));
		}),
		// Actual client component paths (for official HMR module imports)
		svelteClientPaths: roots.map(({ client }) => client),
		svelteServerPaths: roots.map(({ ssr }) => ssr)
	};
};
