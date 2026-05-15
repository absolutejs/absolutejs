/* Phase 2 of the providers-from-handler-call pipeline. Given the call
 * metadata `scanAngularHandlerCalls` returned, emit one generated
 * TypeScript file per page under `.absolutejs/generated/providers/`.
 * Each file re-imports the identifiers the original providers expression
 * referenced, then exports the same expression verbatim — plus, when the
 * call's enclosing Elysia route was a sub-router mount like `/portal/*`,
 * a derived `APP_BASE_HREF` provider so the page never has to write
 * `{ provide: APP_BASE_HREF, useValue: "/portal/" }` by hand.
 *
 * The output is what the Angular client bundle and the SSR handler both
 * import to get the page's providers at bootstrap. No more
 * `Reflect.get(pageModule, "providers")` runtime scan, no more
 * `export const providers` magic on the page module itself. */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { getFrameworkGeneratedDir } from '../utils/generatedDir';
import type { AngularProvidersImport } from './parseAngularConfigImports';
import type {
	AngularHandlerCall,
	ImportSpec
} from './scanAngularHandlerCalls';
import type { AngularPageRoutes } from './scanAngularPageRoutes';

/** Map a TypeScript source path inside the user's `angularDirectory` to
 *  the compiled `.js` location under `.absolutejs/generated/angular/`.
 *  Mirrors the layout `compileAngularFileJIT` writes — every input file's
 *  output is `<angularGeneratedDir>/<pathRelativeToAngularDir>.js`.
 *
 *  Returning the compiled `.js` here (instead of the original source `.ts`)
 *  is what lets the generated providers file dynamically import at SSR
 *  without triggering `bootstrapApplication`'s JIT `templateUrl`/`styleUrl`
 *  fetcher: the compiled output has those already inlined. The source path
 *  is returned unchanged when it falls outside `angularDir` (e.g. backend
 *  files referenced by a handler-call `providers:` arg). */
const mapToCompiledPath = (
	sourceAbsPath: string,
	angularDir: string,
	angularGeneratedDir: string
): string => {
	const normalizedSrc = resolve(sourceAbsPath);
	const normalizedAngularDir = resolve(angularDir);
	if (
		!normalizedSrc.startsWith(`${normalizedAngularDir}/`) &&
		normalizedSrc !== normalizedAngularDir
	) {
		return normalizedSrc;
	}
	const relPath = normalizedSrc.slice(normalizedAngularDir.length + 1);
	const compiledRelPath = relPath.replace(/\.[cm]?[tj]sx?$/, '.js');

	return join(angularGeneratedDir, compiledRelPath);
};

/** Render an import specifier relative to `fromDir` to `targetAbsPath`,
 *  with the extension elided so Bun's resolver picks the on-disk variant
 *  (`.js` for compiled outputs, `.ts` if the source is still raw). */
const relativeImportSpecifier = (fromDir: string, targetAbsPath: string) => {
	const targetWithoutExt = targetAbsPath.replace(/\.[cm]?[tj]sx?$/, '');
	const rel = relative(fromDir, targetWithoutExt).replace(/\\/g, '/');

	return rel.startsWith('.') ? rel : `./${rel}`;
};

export type EmittedProvidersFile = {
	manifestKey: string;
	/** Absolute path to the emitted file. */
	outputPath: string;
	/** The mount path (e.g. `/portal/`) the generated file derived
	 *  APP_BASE_HREF from, or null when the call wasn't inside a
	 *  sub-router route. */
	basePath: string | null;
	/** `true` when the call carried a `providers:` argument. */
	hasProviders: boolean;
};

const buildModuleSpecifier = (
	importSpec: ImportSpec,
	outputPath: string
): string => {
	// Bare specifier — re-emit as-is. The build's normal Angular
	// vendor-resolution will handle it.
	if (!importSpec.resolvedAbsPath) return importSpec.source;

	const outputDir = dirname(outputPath);
	const rel = relative(outputDir, importSpec.resolvedAbsPath).replace(
		/\\/g,
		'/'
	);

	// Strip the source extension so the importer doesn't lock onto a
	// `.ts` file that may compile to `.js`. Bundlers resolve the
	// extensionless form to whichever the target supports.
	const withoutExt = rel.replace(/\.[cm]?[tj]sx?$/, '');

	return withoutExt.startsWith('.') ? withoutExt : `./${withoutExt}`;
};

const buildImportLine = (
	importSpec: ImportSpec,
	outputPath: string
): string => {
	const specifier = buildModuleSpecifier(importSpec, outputPath);
	if (importSpec.isDefault) {
		return `import ${importSpec.localName} from "${specifier}";`;
	}
	if (importSpec.importedName === '*') {
		return `import * as ${importSpec.localName} from "${specifier}";`;
	}
	if (importSpec.importedName === importSpec.localName) {
		return `import { ${importSpec.localName} } from "${specifier}";`;
	}

	return `import { ${importSpec.importedName} as ${importSpec.localName} } from "${specifier}";`;
};

/** Group imports by their source so the emitted file looks like a
 *  hand-written file instead of one named import per line. */
const groupImports = (specs: ImportSpec[]): ImportSpec[][] => {
	const bySource = new Map<string, ImportSpec[]>();
	for (const spec of specs) {
		const list = bySource.get(spec.source);
		if (list) {
			// Skip exact duplicates (same local name twice).
			if (!list.some((existing) => existing.localName === spec.localName)) {
				list.push(spec);
			}
		} else {
			bySource.set(spec.source, [spec]);
		}
	}

	return [...bySource.values()];
};

const renderImportGroup = (
	specs: ImportSpec[],
	outputPath: string
): string => {
	// Default / namespace imports stand alone; named imports collapse
	// into one declaration per source.
	const named: ImportSpec[] = [];
	const standalone: string[] = [];

	for (const spec of specs) {
		if (spec.isDefault || spec.importedName === '*') {
			standalone.push(buildImportLine(spec, outputPath));
		} else {
			named.push(spec);
		}
	}

	const lines: string[] = [...standalone];

	if (named.length > 0) {
		const specifier = buildModuleSpecifier(named[0]!, outputPath);
		const fragments = named.map((spec) =>
			spec.importedName === spec.localName
				? spec.localName
				: `${spec.importedName} as ${spec.localName}`
		);
		lines.push(`import { ${fragments.join(', ')} } from "${specifier}";`);
	}

	return lines.join('\n');
};

const ROUTER_FEATURES_DEFAULT = [
	'withComponentInputBinding',
	'withViewTransitions'
] as const;

type RenderFileContext = {
	angularDir: string;
	angularGeneratedDir: string;
};

const renderFile = (
	call: AngularHandlerCall,
	outputPath: string,
	basePath: string | null,
	pageRoutes: AngularPageRoutes | undefined,
	providersImport: AngularProvidersImport | null,
	context: RenderFileContext
): string => {
	const sections: string[] = [];
	sections.push(
		'/* AUTOGENERATED by AbsoluteJS — see `scanAngularHandlerCalls`. */',
		'/* eslint-disable */'
	);

	const groups = groupImports(call.providerImports);
	if (groups.length > 0) {
		for (const group of groups) {
			sections.push(renderImportGroup(group, outputPath));
		}
	}

	// Global providers from `absolute.config.ts > angular.providers`.
	// The build AST-parsed the config to extract the import source for
	// whatever binding the user passed. Re-imported relative to the
	// generated file's location so every page inherits the user's
	// global Angular DI setup (Firebase init, Sentry error handler,
	// HttpClient, TanStack Query, app initializers, etc.) without
	// writing it per page or per handler call.
	if (providersImport) {
		const outputDir = dirname(outputPath);
		// Resolve to the compiled `.js` under the angular generated tree
		// when the source file lives inside `angularDir`. SSR imports the
		// `.providers.ts` via Bun's runtime transpiler, which does NOT run
		// the Angular template inliner. Pointing at the already-compiled
		// `.js` (whose transitive `.component.ts` deps are inlined by
		// `compileAngularFileJIT`) is what keeps SSR `bootstrapApplication`
		// from trying to JIT-fetch `templateUrl: "./foo.component.html"`.
		const compiledTarget = mapToCompiledPath(
			providersImport.absolutePath,
			context.angularDir,
			context.angularGeneratedDir
		);
		const specifier = relativeImportSpecifier(outputDir, compiledTarget);
		const importClause =
			providersImport.importedName === providersImport.bindingName
				? `{ ${providersImport.bindingName} as __globalProviders }`
				: `{ ${providersImport.importedName} as __globalProviders }`;
		sections.push(`import ${importClause} from "${specifier}";`);
	}

	if (basePath !== null) {
		sections.push(
			`import { APP_BASE_HREF } from "@angular/common";`,
			`const __basePathProvider = { provide: APP_BASE_HREF, useValue: ${JSON.stringify(
				basePath
			)} };`
		);
	}

	// When the page module declares `export const routes: Routes = [...]`,
	// auto-wire `provideRouter(routes, ...defaultFeatures)` — Angular's
	// natural router-config pattern, surfaced for free instead of the
	// user writing the call themselves. Router features default to
	// `withComponentInputBinding()` and `withViewTransitions()`.
	if (pageRoutes?.hasRoutes) {
		// Same reason as for `providersImport` above — point at the
		// compiled `.js` so the SSR-side runtime import doesn't pull the
		// raw page source (with un-inlined `templateUrl`s on sibling
		// components) into JIT.
		const compiledPageTarget = mapToCompiledPath(
			pageRoutes.pageFile,
			context.angularDir,
			context.angularGeneratedDir
		);
		const routesImport = relativeImportSpecifier(
			dirname(outputPath),
			compiledPageTarget
		);
		sections.push(
			`import { ${['provideRouter', ...ROUTER_FEATURES_DEFAULT].join(
				', '
			)} } from "@angular/router";`,
			`import { routes as __pageRoutes } from "${routesImport}";`,
			`const __routerProvider = provideRouter(__pageRoutes, ${ROUTER_FEATURES_DEFAULT.map(
				(name) => `${name}()`
			).join(', ')});`
		);
	}

	const userProvidersExpr = call.providersExpr ?? '[]';
	// Order: global → user-supplied (handler `providers:` arg) → router →
	// basePath. The basePath override comes last so a user-written
	// `APP_BASE_HREF` in `providers:` still wins by Angular's
	// last-provider-rule.
	const fragments: string[] = [];
	if (providersImport) fragments.push('...__globalProviders');
	if (call.providersExpr !== null) fragments.push(`...(${userProvidersExpr})`);
	if (pageRoutes?.hasRoutes) fragments.push('__routerProvider');
	if (basePath !== null) fragments.push('__basePathProvider');
	const exportExpr =
		fragments.length === 0 ? '[]' : `[${fragments.join(', ')}]`;
	sections.push(`export const providers = ${exportExpr};`);

	return sections.join('\n\n') + '\n';
};

/** Convert an Elysia route pattern (e.g. `/portal/*`) into a base path
 *  Angular's `APP_BASE_HREF` accepts (e.g. `/portal/`). Routes that don't
 *  open a sub-namespace (root `/`, single-segment static routes like
 *  `/signin`) return null — no override needed; the framework default
 *  (`/`) is correct. */
const deriveBasePath = (mountPath: string | null): string | null => {
	if (!mountPath) return null;
	if (!mountPath.endsWith('/*')) return null;

	// `/portal/*` → `/portal/`
	const trimmed = mountPath.slice(0, -1);

	return trimmed === '/' ? null : trimmed;
};

export type EmitAngularProvidersOptions = {
	/** AST-extracted import info for the user's `angular.providers`
	 *  binding (from absolute.config.ts). Each emitted file re-imports
	 *  the same binding by its source path so pages and per-handler
	 *  calls never write providers themselves. Null when the config
	 *  doesn't set `angular.providers` — the emitter skips the global
	 *  import. */
	providersImport?: AngularProvidersImport | null;
};

export const emitAngularProvidersFiles = (
	projectRoot: string,
	angularDir: string,
	calls: AngularHandlerCall[],
	pageRoutes: AngularPageRoutes[],
	options: EmitAngularProvidersOptions = {}
): EmittedProvidersFile[] => {
	const outputDir = getProvidersOutputDir(projectRoot);
	mkdirSync(outputDir, { recursive: true });

	const angularGeneratedDir = getFrameworkGeneratedDir('angular', projectRoot);
	const resolvedAngularDir = isAbsolute(angularDir)
		? resolve(angularDir)
		: resolve(projectRoot, angularDir);
	const context: RenderFileContext = {
		angularDir: resolvedAngularDir,
		angularGeneratedDir
	};

	const pageRoutesByKey = new Map<string, AngularPageRoutes>();
	for (const entry of pageRoutes) {
		pageRoutesByKey.set(entry.manifestKey, entry);
	}

	const emitted: EmittedProvidersFile[] = [];
	for (const call of calls) {
		const outputPath = join(outputDir, `${call.manifestKey}.providers.ts`);
		const basePath = deriveBasePath(call.mountPath);
		const pageRoute = pageRoutesByKey.get(call.manifestKey);
		const content = renderFile(
			call,
			outputPath,
			basePath,
			pageRoute,
			options.providersImport ?? null,
			context
		);
		writeFileSync(outputPath, content, 'utf-8');
		emitted.push({
			basePath,
			hasProviders: call.providersExpr !== null,
			manifestKey: call.manifestKey,
			outputPath
		});
	}

	return emitted;
};

/** Absolute path of the directory the emitter writes to. Exposed so other
 *  build steps (`compileAngular`'s client wrapper, the SSR `pageHandler`)
 *  can compute relative paths to the generated files without hard-coding
 *  the convention. */
export const getProvidersOutputDir = (projectRoot: string) =>
	join(getFrameworkGeneratedDir('angular', projectRoot), 'providers');
