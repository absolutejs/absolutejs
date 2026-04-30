import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
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
import { isSsrCacheDirty, markSsrCacheDirty } from '../core/ssrCache';
import {
	buildDeps,
	buildProviders,
	cacheRouteData,
	clearSelectorCache,
	discoverTokens,
	injectSsrScripts,
	loadSsrDeps,
	renderAngularApp,
	resolveSelector
} from './ssrRender';

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

let compilerImportPromise: Promise<unknown> | null = null;
const ensureAngularCompiler = () => {
	if (!compilerImportPromise) {
		compilerImportPromise = import('@angular/compiler');
	}

	return compilerImportPromise;
};

const readAngularPageModule = (value: unknown) =>
	isRecord(value) ? value : null;

const resolveAngularSsrOutDir = () =>
	process.env.ABSOLUTE_ANGULAR_SSR_OUTDIR ??
	join(tmpdir(), 'absolutejs', 'generated', 'angular-ssr');

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
		return pagePath;
	}

	const outDir = resolveAngularSsrOutDir();
	await ensureAngularSsrNodeModules(outDir);
	const { compileAngularFileJIT } = await import('../build/compileAngular');
	const outputs = await compileAngularFileJIT(
		pagePath,
		outDir,
		process.cwd()
	);
	const expectedFileName = basename(pagePath).replace(/\.ts$/, '.js');

	return (
		outputs.find((output) => output.endsWith(`/${expectedFileName}`)) ??
		outputs.find((output) => output.endsWith(`\\${expectedFileName}`)) ??
		outputs[0] ??
		pagePath
	);
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

export const invalidateAngularSsrCache = () => {
	markSsrCacheDirty('angular');
	clearSelectorCache();
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

		if (isSsrCacheDirty('angular')) {
			clearSelectorCache();
			const script = resolvedIndexPath
				? `<script>import(${JSON.stringify(resolvedIndexPath)});</script>`
				: '';
			const html = `<!DOCTYPE html><html>${resolvedHeadTag}<body><${lastSelector}></${lastSelector}>${script}</body></html>`;

			return new Response(html, {
				headers: { 'Content-Type': 'text/html' }
			});
		}

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
					runtimePagePath
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

				const ssrResult = await loadSsrDeps(runtimePagePath);
				const deps = buildDeps(ssrResult, baseDeps);

				const tokenMap = discoverTokens(pageModule);
				const selector = resolveSelector(
					deps,
					resolvedPagePath,
					PageComponent
				);
				lastSelector = selector;

				const htmlString = `<!DOCTYPE html><html>${resolvedHeadTag}<body><${selector}></${selector}></body></html>`;

				if (ssrResult?.core) resetSsrSanitizer();
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

			return runWithStreamingSlotWarningScope(
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
