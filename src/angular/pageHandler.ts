import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { Type } from '@angular/core';
import type {
	AngularPageImporter,
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
export type AngularPageRequestInput<
	Page = { factory: (props: Record<never, never>) => unknown }
> = AngularPageRenderOptions & {
	headTag?: `<head>${string}</head>`;
	indexPath: string;
	pagePath: string;
} & (keyof AngularPagePropsOf<Page> extends never
		? { props?: NoInfer<AngularPagePropsOf<Page>> }
		: { props: NoInfer<AngularPagePropsOf<Page>> });
export type HandleAngularPageRequest = {
	<Page = { factory: (props: Record<never, never>) => unknown }>(
		input: AngularPageRequestInput<Page>
	): Promise<Response>;
	<Props extends Record<string, unknown> = Record<never, never>>(
		Page: AngularPageImporter<Props>,
		pagePath: string,
		indexPath: string,
		headTag: `<head>${string}</head>` | undefined,
		...args: AngularPageHandlerArgs<Props>
	): Promise<Response>;
};
type AngularPageHandlerArgs<Props extends Record<string, unknown>> =
	keyof Props extends never
		? [props?: NoInfer<Props>, options?: AngularPageRenderOptions]
		: [props: NoInfer<Props>, options?: AngularPageRenderOptions];
const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const isAngularComponent = (value: unknown): value is Type<unknown> =>
	typeof value === 'function';

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

export const invalidateAngularSsrCache = () => {
	markSsrCacheDirty('angular');
	clearSelectorCache();
};

const angularSsrContext = new AsyncLocalStorage<string>();
setSsrContextGetter(() => angularSsrContext.getStore());

export const handleAngularPageRequest = (async <
	Props extends Record<string, unknown> = Record<never, never>
>(
	PageOrInput: AngularPageImporter<Props> | AngularPageRequestInput<Props>,
	pagePath?: string,
	indexPath?: string,
	headTag: `<head>${string}</head>` = '<head></head>',
	...args: AngularPageHandlerArgs<Props>
) => {
	const requestId = `angular_${Date.now()}_${Math.random().toString(BASE_36_RADIX).substring(2, RANDOM_ID_END_INDEX)}`;

	return angularSsrContext.run(requestId, async () => {
		await ensureAngularCompiler();
		const {
			headTag: resolvedHeadTag,
			indexPath: resolvedIndexPath,
			options,
			pagePath: resolvedPagePath,
			props: maybeProps
		} = typeof PageOrInput === 'object' &&
		PageOrInput !== null &&
		'pagePath' in PageOrInput &&
		'indexPath' in PageOrInput
			? {
					headTag: PageOrInput.headTag ?? '<head></head>',
					indexPath: PageOrInput.indexPath,
					options: PageOrInput as AngularPageRenderOptions,
					pagePath: PageOrInput.pagePath,
					props: PageOrInput.props
				}
			: {
					headTag,
					indexPath: indexPath ?? '',
					options: args[1],
					pagePath: pagePath ?? '',
					props: args[0]
				};

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
				const PageComponent = pageModule.default;
				if (!isAngularComponent(PageComponent)) {
					throw new Error(
						`Angular page module must export a component by default: ${resolvedPagePath}`
					);
				}
				const hasIslands =
					typeof pageModule.__ABSOLUTE_PAGE_HAS_ISLANDS__ ===
					'boolean'
						? pageModule.__ABSOLUTE_PAGE_HAS_ISLANDS__
						: false;

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
				const providers = buildProviders(
					deps,
					sanitizer,
					maybeProps,
					tokenMap
				);

				const rawHtml: string = await renderAngularApp(
					deps,
					PageComponent,
					providers,
					htmlString
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

				return new Response(html, {
					headers: { 'Content-Type': 'text/html' }
				});
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
}) as HandleAngularPageRequest;
