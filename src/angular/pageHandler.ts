import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { EnvironmentProviders, Provider, Type } from '@angular/core';
import type {
	AngularPageDefinition,
	AngularPagePropsOf
} from '../../types/angular';
import { BASE_36_RADIX, RANDOM_ID_END_INDEX } from '../constants';
import { injectIslandPageContext } from '../core/islandPageContext';
import { ssrErrorPage } from '../utils/ssrErrorPage';
import {
	derivePageName,
	renderConventionError
} from '../utils/resolveConvention';
import { setSsrContextGetter } from '../utils/registerClientScript';
import { getAngularDeps } from './angularDeps';
import { buildServerAnimationProviders } from './animationProviders';
import { buildRouterRedirectProviders } from './routerRedirectProviders';
import { lowerAngularServerIslands } from './lowerServerIslands';
import { getCurrentRouteRegistrationCallsite } from '../core/devRouteRegistrationCallsite';
import { getSsrSanitizer, resetSsrSanitizer } from './ssrSanitizer';
import {
	type StreamingSlotEnhancerOptions,
	withRegisteredStreamingSlots
} from '../core/responseEnhancers';
import {
	captureStreamingSlotWarningCallsite,
	runWithStreamingSlotWarningScope
} from '../core/streamingSlotWarningScope';
import {
	buildProviders,
	cacheRouteData,
	discoverTokens,
	injectSsrScripts,
	renderAngularApp,
	resolveSelector
} from './ssrRender';
import { resolveAngularRuntimePath } from './resolveAngularPackage';
import { isProductionRuntime } from '../utils/runtimeMode';

let lastSelector = 'angular-page';
type AngularPageRenderOptions = StreamingSlotEnhancerOptions & {
	collectStreamingSlots?: boolean;
};
type IsAny<T> = 0 extends 1 & T ? true : false;
type HasNoRequiredAngularProps<Props> =
	IsAny<Props> extends true ? true : keyof Props extends never ? true : false;
type AngularPageHasOptionalProps<Page> = Page extends {
	page: AngularPageDefinition<infer Props>;
}
	? HasNoRequiredAngularProps<Props>
	: Page extends { default: AngularPageDefinition<infer Props> }
		? HasNoRequiredAngularProps<Props>
		: HasNoRequiredAngularProps<AngularPagePropsOf<Page>>;
export type AngularPageRequestInput<
	Page = { page: AngularPageDefinition<Record<never, never>> }
> = AngularPageRenderOptions & {
	headTag?: `<head>${string}</head>`;
	indexPath: string;
	pagePath: string;
	/** The incoming request. When provided, its URL is forwarded to
	 *  Angular's `renderApplication`, so `LocationStrategy.path()` and
	 *  Angular Router both see the real URL instead of `/`. Without it,
	 *  Router-based pages can't match anything but the root route. */
	request?: Request;
	/** Per-request context made available through Angular's REQUEST_CONTEXT token. */
	requestContext?: unknown;
	/** Mutable response init made available through Angular's RESPONSE_INIT token. */
	responseInit?: ResponseInit;
	/** Sitemap metadata for this route. Statically read from the handler
	 *  source at registration time, so only literal-object values are
	 *  honoured. For finer control use `Route.data.sitemap` in the
	 *  page's `Routes` config, or `sitemap.overrides` in `absolute.config.ts`. */
	sitemap?: import('../../types/sitemap').PageHandlerSitemapMetadata;
} & (AngularPageHasOptionalProps<Page> extends true
		? { props?: NoInfer<AngularPagePropsOf<Page>> }
		: { props: NoInfer<AngularPagePropsOf<Page>> });
const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const isAngularComponent = (value: unknown): value is Type<unknown> =>
	typeof value === 'function';

const isAngularPageDefinition = (
	value: unknown
): value is AngularPageDefinition<Record<string, unknown>> =>
	isRecord(value) && isAngularComponent(value.component);

const resolvePageComponent = (pageModule: Record<string, unknown>) => {
	const page = Reflect.get(pageModule, 'page');
	if (isAngularPageDefinition(page)) {
		return page.component;
	}

	const defaultExport = pageModule.default;
	if (isAngularPageDefinition(defaultExport)) {
		return defaultExport.component;
	}

	if (isAngularComponent(defaultExport)) {
		return defaultExport;
	}

	return Object.values(pageModule).find((value) => isAngularComponent(value));
};

// `@angular/compiler` is required at request time only in dev, where
// `compileAngularFileJIT` produces partial declarations that need the
// compiler facade to link. In production every partial has already been
// linked at build time by the linker plugin, so the compiler isn't loaded
// or shipped.
let compilerImportPromise: Promise<unknown> | null = null;
const ensureAngularCompiler = () => {
	if (isProductionRuntime()) return Promise.resolve();
	if (!compilerImportPromise) {
		// §1.1 — bare specifier in dev so Bun shares one cached module
		// with bundled server pages (which also import bare `@angular/*`
		// after the server-vendor rewrite was disabled).
		compilerImportPromise = import('@angular/compiler');
	}

	return compilerImportPromise;
};

const readAngularPageModule = (value: unknown) =>
	isRecord(value) ? value : null;

const resolveAngularSsrOutDir = () =>
	process.env.ABSOLUTE_ANGULAR_SSR_OUTDIR ??
	join(tmpdir(), 'absolutejs', 'generated', 'angular-ssr');

const createAngularRuntimeCacheBuster = () =>
	`${Date.now().toString(BASE_36_RADIX)}.${Math.random()
		.toString(BASE_36_RADIX)
		.substring(2, RANDOM_ID_END_INDEX)}`;

const ensureAngularSsrNodeModules = async (outDir: string) => {
	const outRoot = resolve(dirname(dirname(outDir)));
	const nodeModulesLink = join(outRoot, 'node_modules');
	if (process.env.ABSOLUTE_ANGULAR_SSR_OUTDIR) {
		return;
	}
	if (nodeModulesLink === resolve(process.cwd(), 'node_modules')) {
		return;
	}
	if (await Bun.file(nodeModulesLink).exists()) {
		return;
	}

	await mkdir(outRoot, { recursive: true });
	try {
		await symlink(
			resolve(process.cwd(), 'node_modules'),
			nodeModulesLink,
			'dir'
		);
	} catch (error) {
		if (
			!(error instanceof Error) ||
			!('code' in error) ||
			error.code !== 'EEXIST'
		) {
			throw error;
		}
	}
};

const resolveRuntimeAngularModulePath = async (pagePath: string) => {
	if (!pagePath.endsWith('.ts')) {
		// In dev, the manifest points at `.ssr.js` / `.js` bundles whose
		// path stays stable across rebuilds (no content-hash in the
		// filename). After a tier-0 bundle rebuild, the file content
		// changes but the URL doesn't — so `await import(url)` returns
		// Bun's cached module and SSR serves pre-edit bytes. Use the
		// file's mtime as a cacheBuster so a fresh write cracks the
		// import cache while unchanged files keep their cached module.
		// In production, NODE_ENV !== 'development' skips the stat and
		// avoids the per-request filesystem hit.
		if (process.env.NODE_ENV === 'development') {
			try {
				const { stat } = await import('node:fs/promises');
				const stats = await stat(pagePath);
				return {
					path: pagePath,
					cacheBuster: stats.mtimeMs.toString(BASE_36_RADIX)
				};
			} catch {
				return { path: pagePath, cacheBuster: undefined };
			}
		}
		return {
			path: pagePath,
			cacheBuster: undefined
		};
	}

	const outDir = resolveAngularSsrOutDir();
	await ensureAngularSsrNodeModules(outDir);
	const { compileAngularFileJIT } = await import('../build/compileAngular');
	const cacheBuster = createAngularRuntimeCacheBuster();
	const outputs = await compileAngularFileJIT(
		pagePath,
		outDir,
		process.cwd(),
		undefined,
		cacheBuster
	);
	const expectedFileName = basename(pagePath).replace(/\.ts$/, '.js');

	const runtimePagePath =
		outputs.find((output) => output.endsWith(`/${expectedFileName}`)) ??
		outputs.find((output) => output.endsWith(`\\${expectedFileName}`)) ??
		outputs[0] ??
		pagePath;

	return {
		path: runtimePagePath,
		cacheBuster
	};
};

const buildRuntimeModuleSpecifier = (
	modulePath: string,
	cacheBuster?: string
) => {
	if (!cacheBuster) {
		return modulePath;
	}

	const moduleUrl = new URL(pathToFileURL(modulePath).href);
	moduleUrl.searchParams.set('t', cacheBuster);

	return moduleUrl.href;
};

const withHtmlContentType = (responseInit: ResponseInit = {}) => {
	const headers = new Headers(responseInit.headers);
	if (!headers.has('Content-Type')) {
		headers.set('Content-Type', 'text/html');
	}

	return { ...responseInit, headers };
};

const resolveRequestRenderUrl = (request: Request | undefined) => {
	if (!request) return '/';

	try {
		const parsed = new URL(request.url);

		return `${parsed.pathname}${parsed.search}`;
	} catch {
		return '/';
	}
};

const assertNoHandlerProviders = (input: Record<string, unknown>) => {
	if (!('providers' in input)) return;

	throw new Error(
		'Angular handler providers are not supported. Export `providers` from the Angular page module, or inject REQUEST / REQUEST_CONTEXT for request-scoped data.'
	);
};

const angularSsrContext = new AsyncLocalStorage<string>();
setSsrContextGetter(() => angularSsrContext.getStore());

export const handleAngularPageRequest = async <
	Page = { page: AngularPageDefinition<Record<never, never>> }
>(
	input: AngularPageRequestInput<Page>
) => {
	const requestId = `angular_${Date.now()}_${Math.random().toString(BASE_36_RADIX).substring(2, RANDOM_ID_END_INDEX)}`;

	return angularSsrContext.run(requestId, async () => {
		await ensureAngularCompiler();

		const resolvedHeadTag = input.headTag ?? '<head></head>';
		const resolvedIndexPath = input.indexPath;
		const options = input;
		const resolvedPagePath = input.pagePath;
		const maybeProps = input.props;
		const responseInit = input.responseInit ?? {};
		const resolvedUrl = resolveRequestRenderUrl(input.request);

		// Cache props + headTag for HMR replay — strip query strings
		// so cache-busted HMR paths match the original manifest path.
		cacheRouteData(resolvedPagePath, {
			headTag: resolvedHeadTag,
			props: maybeProps
		});

		try {
			assertNoHandlerProviders(input);

			const handlerCallsite =
				options?.collectStreamingSlots === true
					? undefined
					: (getCurrentRouteRegistrationCallsite() ??
						captureStreamingSlotWarningCallsite());
			const renderPageResponse = async () => {
				const baseDeps = await getAngularDeps();
				const runtimePagePath =
					await resolveRuntimeAngularModulePath(resolvedPagePath);
				const importedPageModule: unknown = await import(
					buildRuntimeModuleSpecifier(
						runtimePagePath.path,
						runtimePagePath.cacheBuster
					)
				);
				const pageModule = readAngularPageModule(importedPageModule);
				if (!pageModule) {
					throw new Error(
						`Invalid Angular page module: ${resolvedPagePath}`
					);
				}
				const PageComponent = resolvePageComponent(pageModule);
				if (!isAngularComponent(PageComponent)) {
					throw new Error(
						`Angular page module must export an Angular component: ${resolvedPagePath}`
					);
				}
				const hasIslands =
					typeof pageModule.__ABSOLUTE_PAGE_HAS_ISLANDS__ ===
					'boolean'
						? pageModule.__ABSOLUTE_PAGE_HAS_ISLANDS__
						: false;
				const usesLegacyAnimations =
					pageModule.__ABSOLUTE_PAGE_USES_LEGACY_ANIMATIONS__ ===
					true;

				const deps = baseDeps;

				const tokenMap = discoverTokens(pageModule);
				const selector = resolveSelector(
					deps,
					resolvedPagePath,
					PageComponent
				);
				lastSelector = selector;

				const htmlString = `<!DOCTYPE html><html>${resolvedHeadTag}<body><${selector}></${selector}></body></html>`;

				resetSsrSanitizer();
				const sanitizer = getSsrSanitizer(deps);
				// The page module's `providers` export is the source of truth
				// for page-level DI — `bootstrapApplication` reads it on the
				// client (see compileAngular.ts client bootstrap). Mirror that
				// on the server so anything that requires `provideRouter`,
				// `provideAnimations`, etc. resolves the same way during SSR.
				const pageProvidersExport = Reflect.get(
					pageModule,
					'providers'
				);
				const pageProviders: ReadonlyArray<
					Provider | EnvironmentProviders
				> = Array.isArray(pageProvidersExport)
					? pageProvidersExport
					: [];
				const combinedProviders = [
					...(await buildRouterRedirectProviders(deps, responseInit)),
					...pageProviders,
					...(await buildServerAnimationProviders(
						usesLegacyAnimations
					))
				];
				const providers = buildProviders(
					deps,
					sanitizer,
					maybeProps,
					tokenMap,
					input.request,
					input.requestContext,
					responseInit,
					combinedProviders
				);

				const rawHtml: string = await renderAngularApp(
					deps,
					PageComponent,
					providers,
					htmlString,
					resolvedUrl
				);
				const shouldProcessIslands =
					hasIslands || rawHtml.includes('<absolute-island');
				const htmlWithLoweredIslands = shouldProcessIslands
					? await lowerAngularServerIslands(rawHtml)
					: rawHtml;

				const html = injectIslandPageContext(
					injectSsrScripts(
						htmlWithLoweredIslands,
						requestId,
						resolvedIndexPath,
						maybeProps
					),
					{ hasIslands: shouldProcessIslands }
				);

				return new Response(html, withHtmlContentType(responseInit));
			};

			return await runWithStreamingSlotWarningScope(
				() =>
					options?.collectStreamingSlots === true
						? withRegisteredStreamingSlots(
								renderPageResponse,
								options
							)
						: renderPageResponse(),
				{ handlerCallsite }
			);
		} catch (error) {
			console.error('[SSR] Angular render error:', error);

			const pageName = derivePageName(resolvedPagePath);
			const conventionResponse = await renderConventionError(
				'angular',
				pageName,
				error
			);
			if (conventionResponse) return conventionResponse;

			return new Response(ssrErrorPage('angular', error), {
				headers: { 'Content-Type': 'text/html' },
				status: 500
			});
		}
	});
};
