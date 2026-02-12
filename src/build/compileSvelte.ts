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

		// Generate HMR ID from relative file path
		const hmrId = relative(svelteRoot, src)
			.replace(/\\/g, '/')
			.replace(/\.svelte(\.(ts|js))?$/, '');

		// HMR wrapper for client components
		const wrapWithHMR = (code: string) => {
			if (!dev) return code;
			return `${code}

// Svelte HMR - accept updates and re-mount component
if (typeof import.meta !== "undefined" && import.meta.hot) {
  import.meta.hot.accept(async (newModule) => {
    if (newModule && newModule.default && typeof window !== "undefined") {
      console.log('[HMR] Svelte component updated:', ${JSON.stringify(hmrId)});
      // Store props before destroying
      const currentProps = window.__SVELTE_PROPS__ || window.__INITIAL_PROPS__ || {};
      // Destroy old component if it exists
      if (window.__SVELTE_COMPONENT__) {
        try {
          // Svelte 5 uses unmount, Svelte 4 uses $destroy
          if (typeof window.__SVELTE_COMPONENT__.unmount === 'function') {
            window.__SVELTE_COMPONENT__.unmount();
          } else if (typeof window.__SVELTE_COMPONENT__.$destroy === 'function') {
            window.__SVELTE_COMPONENT__.$destroy();
          }
        } catch (e) {
          console.warn('[HMR] Error destroying old component:', e);
        }
      }
      // Mount new component with preserved props
      try {
        const { mount } = await import('svelte');
        window.__SVELTE_COMPONENT__ = mount(newModule.default, {
          target: document.body,
          props: currentProps
        });
        window.__SVELTE_PROPS__ = currentProps;
        console.log('[HMR] Svelte component re-mounted with preserved state');
      } catch (e) {
        console.warn('[HMR] Error mounting new component:', e);
        window.location.reload();
      }
    }
  });
}`;
		};

		if (isModule) {
			const bundle = generate('client');
			const clientBundleWithHMR = wrapWithHMR(bundle);
			await Promise.all([
				write(ssrPath, bundle),
				write(clientPath, clientBundleWithHMR)
			]);
		} else {
			const serverBundle = generate('server');
			const clientBundle = generate('client');
			const clientBundleWithHMR = wrapWithHMR(clientBundle);
			await Promise.all([
				write(ssrPath, serverBundle),
				write(clientPath, clientBundleWithHMR)
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
// For HMR updates: Use clone overlay + forced reflow (guaranteed zero flicker)
// For initial load: use hydrate() to attach to server-rendered HTML
let component;
if (isHMRUpdate) {
  // Step 1: Clone current content (keeps it visible)
  const bodyClone = document.body.cloneNode(true);
  bodyClone.style.position = 'fixed';
  bodyClone.style.top = '0';
  bodyClone.style.left = '0';
  bodyClone.style.width = '100%';
  bodyClone.style.height = '100%';
  bodyClone.style.zIndex = '99999';
  bodyClone.style.pointerEvents = 'none';
  bodyClone.style.background = window.getComputedStyle(document.body).background || '#fff';
  document.body.appendChild(bodyClone);
  
  // Step 2: Mount new component off-screen
  const offscreenContainer = document.createElement('div');
  component = mount(C, { target: offscreenContainer, props: mergedProps });
  const newChildren = Array.from(offscreenContainer.childNodes);
  
  // Step 3: Replace body children (happens under the clone)
  const oldChildren = Array.from(document.body.childNodes).filter(child => child !== bodyClone);
  oldChildren.forEach(child => child.remove());
  newChildren.forEach(child => document.body.insertBefore(child, bodyClone));
  
  // Step 4: Force reflow to ensure new content is painted
  document.body.offsetHeight;
  
  // Step 5: Remove clone to reveal new content (already painted)
  bodyClone.remove();
} else {
  // Initial load: hydrate server-rendered HTML
  component = hydrate(C, { target: document.body, props: mergedProps });
}
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
