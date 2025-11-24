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
	cache: Cache = new Map()
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

	const dev = env.NODE_ENV === 'development';

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
			await Promise.all([
				write(ssrPath, bundle),
				write(clientPath, bundle)
			]);
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
			const bootstrap = `import C from "${importPath}";
import { hydrate, mount } from "svelte";
// HMR State Preservation: Check for preserved state and merge with initial props
const preservedState = (typeof window !== "undefined" && window.__HMR_PRESERVED_STATE__) ? window.__HMR_PRESERVED_STATE__ : {};
const mergedProps = { ...(window.__INITIAL_PROPS__ ?? {}), ...preservedState };
console.log('📦 Svelte index: mergedProps =', JSON.stringify(mergedProps));
// Clear preserved state after using it
if (typeof window !== "undefined") {
  window.__HMR_PRESERVED_STATE__ = undefined;
}
// Check if this is an HMR update (flag set by client HMR handler)
const isHMRUpdate = typeof window !== 'undefined' && window.__SVELTE_HMR_UPDATE__ === true;
console.log('📦 Svelte index: isHMRUpdate =', isHMRUpdate);
// Clear HMR update flag
if (typeof window !== 'undefined') {
  window.__SVELTE_HMR_UPDATE__ = false;
}
// For HMR updates: clear the body before mounting to prevent duplicate content
if (isHMRUpdate && typeof window !== 'undefined') {
  console.log('🔄 Clearing body for fresh Svelte mount...');
  document.body.innerHTML = '';
}
// For HMR updates: use mount() to create a fresh component with preserved props
// For initial load: use hydrate() to attach to server-rendered HTML
const component = isHMRUpdate
  ? mount(C, { target: document.body, props: mergedProps })
  : hydrate(C, { target: document.body, props: mergedProps });
console.log('✅ Svelte component', isHMRUpdate ? 'mounted' : 'hydrated', 'with props:', JSON.stringify(mergedProps));
// Store component instance for future HMR updates
if (typeof window !== "undefined") {
  window.__SVELTE_COMPONENT__ = component;
}`;

			await mkdir(dirname(indexPath), { recursive: true });

			return write(indexPath, bootstrap);
		})
	);

	return {
		svelteClientPaths: roots.map(({ client }) => {
			const rel = dirname(relative(clientDir, client));

			return join(indexDir, rel, basename(client));
		}),
		svelteServerPaths: roots.map(({ ssr }) => ssr)
	};
};
