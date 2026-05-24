import { mkdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { resolveAngularRuntimePath } from '../angular/resolveAngularPackage';
import { rewriteImportsInContent } from '../build/rewriteImportsPlugin';
import { isProductionRuntime } from '../utils/runtimeMode';

// On-the-fly server-module compiler for cross-framework Angular islands —
// the Angular analogue of `compileSvelteServerModule`/`compileVueServerModule`.
//
// At SSR the island registry's build reference for an Angular island points at
// the raw component `.ts`. Importing it directly resolves its bare `@angular/*`
// to node_modules — a DIFFERENT Angular instance than the pre-linked server
// vendor that the render pipeline (`getAngularDeps`) and every bundled server
// page use — so the JIT-compiled component injects across instances and every
// DI lookup fails with NG0201. (Dev shares one node_modules Angular, so it only
// bites production.)
//
// Fix: bundle the component with its relative deps (sibling components, the
// shared store) but leave every npm package external, then rewrite the bare
// `@angular/*` specifiers to the same vendor files `getAngularDeps` resolves.
// The component then JIT-compiles against the vendor Angular, so its factory and
// the render pipeline's injector share one instance. Package deps stay external:
// `@angular/*` is redirected to the vendor; `IslandStore`
// (`@absolutejs/absolute/angular`, `providedIn: 'root'`, no constructor deps)
// resolves cross-instance via its plain `ɵprov`; and the vendor
// `@angular/compiler` JIT facade is already loaded by the bundled server entry.
// (Bundling the package graph instead drags in Angular's SSR view-engine
// optional deps — `consolidate` → ejs/handlebars/… — which fail to resolve.)

const serverCacheRoot = join(
	process.cwd(),
	'.absolutejs',
	'islands',
	'angular'
);
const compiledModuleCache = new Map<string, Promise<string>>();
const ANGULAR_SPECIFIER_RE = /["'](@angular\/[^"']+)["']/g;

const getCachedModulePath = (sourcePath: string) => {
	const relativeSourcePath = relative(process.cwd(), sourcePath).replace(
		/\\/g,
		'/'
	);
	const normalizedSourcePath = relativeSourcePath.startsWith('..')
		? sourcePath.replace(/[:\\/]/g, '_')
		: relativeSourcePath;

	return join(serverCacheRoot, `${normalizedSourcePath}.server.js`);
};

// Map every `@angular/*` specifier the bundle still imports to its vendor file.
// Gated on `isProductionRuntime()` to stay in lockstep with `getAngularDeps`,
// which only resolves to the vendor in production (`useBareSpecifiers =
// !isProductionRuntime()`) and uses bare node_modules specifiers otherwise — in
// dev and during the build-time static prerender. Rewriting unconditionally
// would pin the component to the vendor while the render pipeline used
// node_modules, re-creating the NG0201 dual-instance split in reverse.
const collectVendorPaths = (code: string) => {
	const vendorPaths: Record<string, string> = {};
	if (!isProductionRuntime()) {
		return vendorPaths;
	}
	const specifiers = new Set(
		[...code.matchAll(ANGULAR_SPECIFIER_RE)].map((match) => match[1])
	);
	specifiers.forEach((specifier) => {
		if (!specifier) return;
		const resolved = resolveAngularRuntimePath(specifier);
		if (resolved === specifier) return;
		vendorPaths[specifier] = resolved;
	});

	return vendorPaths;
};

const buildAngularServerModule = async (sourcePath: string) => {
	const result = await Bun.build({
		entrypoints: [sourcePath],
		format: 'esm',
		packages: 'external',
		target: 'bun',
		throw: false
	});
	const entry = result.outputs.find(
		(output) => output.kind === 'entry-point'
	);
	if (!result.success || !entry) {
		const message = result.logs.map((log) => String(log)).join('\n');
		throw new Error(
			`Failed to compile Angular island server module for "${sourcePath}":\n${message}`
		);
	}

	const code = await entry.text();
	const rewritten = rewriteImportsInContent(code, collectVendorPaths(code));
	const modulePath = getCachedModulePath(sourcePath);
	await mkdir(dirname(modulePath), { recursive: true });
	await Bun.write(modulePath, rewritten);

	return modulePath;
};

export const compileAngularServerModule = (sourcePath: string) => {
	const cached = compiledModuleCache.get(sourcePath);
	if (cached) {
		return cached;
	}

	const compiledModulePromise = buildAngularServerModule(sourcePath);
	compiledModuleCache.set(sourcePath, compiledModulePromise);

	return compiledModulePromise;
};
