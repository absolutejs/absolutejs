import type TypeScript from 'typescript';
import { createRequire } from 'node:module';

/* `typescript` is a 9 MB CommonJS module that takes most of a second to
   evaluate. The framework only needs it for source analysis (route scans,
   island registries, Angular compilation, config editing), never to serve a
   request, so a static `import ts from 'typescript'` made every server pay
   that cost at startup. This proxy loads it synchronously on first property
   access and caches it, so callers keep writing `ts.createSourceFile(...)`
   and stay synchronous. Import TypeScript's types with `import type`. */

let loaded: typeof TypeScript | undefined;

const loadTypescript = () => {
	if (loaded) return loaded;
	const requireFromHere = createRequire(import.meta.url);
	const typescript: typeof TypeScript = requireFromHere('typescript');
	loaded = typescript;

	return typescript;
};

const createLazyTypescript = () => {
	const target: typeof TypeScript = Object.create(null);

	return new Proxy(target, {
		get: (_target, key) => Reflect.get(loadTypescript(), key),
		has: (_target, key) => Reflect.has(loadTypescript(), key)
	});
};

const lazyTypescript = createLazyTypescript();

export { lazyTypescript as ts };
