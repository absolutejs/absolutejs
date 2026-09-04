import type { Component as SvelteComponent } from 'svelte';
import type { SveltePropsOf } from '../../types/svelte';
import { compileSvelteServerModule } from '../core/svelteServerModule';
import { injectIslandPageContextStream } from '../core/islandPageContext';
import { getCurrentRouteRegistrationCallsite } from '../core/devRouteRegistrationCallsite';
import {
	getCurrentAbsoluteRequest,
	resolveDeferredPageAssets,
	withDeferredStylesheets
} from '../core/requestContext';
import type { AbsoluteMobileBuildPageMetadata } from '../mobile/buildMetadata';
import {
	ABSOLUTE_MOBILE_PAGE_PROTOCOL_VERSION,
	finalizeAbsoluteMobilePage
} from '../mobile/pageProtocol';
import {
	streamingPageHeaders,
	withPageCacheHeaders
} from '../core/pageResponseCache';
import {
	type StreamingSlotEnhancerOptions,
	withRegisteredStreamingSlots
} from '../core/responseEnhancers';
import {
	captureStreamingSlotWarningCallsite,
	runWithStreamingSlotWarningScope
} from '../core/streamingSlotWarningScope';
import { readHeadStylesheets, readHeadTitle } from '../core/routeAssets';
import { readSiblingCss } from '../utils/inlinePageCss';
import { ssrErrorPage } from '../utils/ssrErrorPage';
import { renderSpaNotFound } from '../utils/spaRouteManifest';
import {
	derivePageName,
	renderConventionError
} from '../utils/resolveConvention';
import { BROWSER_TRANSLATION_BASELINE_SCRIPT } from '../core/browserTranslation';

type GenericSvelteComponent = SvelteComponent<Record<string, unknown>>;
type ResolvedSveltePage = {
	component: GenericSvelteComponent;
	hasIslands: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const isGenericSvelteComponent = (
	value: unknown
): value is GenericSvelteComponent =>
	typeof value === 'function' || isRecord(value);

const readHasIslands = (value: unknown) => {
	if (!isRecord(value)) return false;
	const hasIslands = value['__ABSOLUTE_PAGE_HAS_ISLANDS__'];

	return typeof hasIslands === 'boolean' ? hasIslands : false;
};

const readDefaultExport = (value: unknown) =>
	isRecord(value) ? value.default : undefined;

const primeSvelteStream = async <T>(stream: ReadableStream<T>) => {
	const reader = stream.getReader();
	const firstChunk = await reader.read();

	return { firstChunk, reader };
};

const restorePrimedStream = <T>(
	firstChunk: Awaited<ReturnType<ReadableStreamDefaultReader<T>['read']>>,
	reader: ReadableStreamDefaultReader<T>
) =>
	new ReadableStream<T>({
		start(controller) {
			if (!firstChunk.done) controller.enqueue(firstChunk.value);
			if (firstChunk.done) {
				controller.close();

				return;
			}
			const pumpLoop = () => {
				reader
					.read()
					.then(({ done, value }) =>
						done
							? controller.close()
							: (controller.enqueue(value), pumpLoop())
					)
					.catch((err) => controller.error(err));
			};
			pumpLoop();
		}
	});

export type SveltePageRenderOptions = {
	collectStreamingSlots?: boolean;
	bodyContent?: string;
	headContent?: string;
	/** Buffer this page's stream so it can carry a content-hash `ETag` and
	 *  serve a `304` on repeat visits, at the cost of streaming's fast first
	 *  byte. Only worth it on pages static enough that the 304 beats the
	 *  stream. See {@link PageCacheOptions.bufferStreamForEtag}. */
	bufferStreamForEtag?: boolean;
} & StreamingSlotEnhancerOptions;

type HasNoSvelteProps<Props> = [Props] extends [never]
	? true
	: keyof Props extends never
		? true
		: false;

export type SveltePageRequestInput<
	Component extends SvelteComponent<never> = SvelteComponent<
		Record<never, never>
	>
> = SveltePageRenderOptions & {
	/** @internal Build-generated mobile identity. Application code must not set this. */
	__absoluteMobile?: AbsoluteMobileBuildPageMetadata;
	indexPath: string;
	pagePath: string;
	/** The incoming Elysia request. When provided, the request's pathname
	 *  is auto-injected into props as `url` so the page can pass it into
	 *  `<Router url={url}>` without the caller threading it by hand.
	 *  User-supplied `props.url` (if present) takes precedence. */
	request?: Request;
	/** Sitemap metadata for this route. Statically read from the handler
	 *  source at registration time, so only literal-object values are
	 *  honoured. */
	sitemap?: import('../../types/sitemap').PageHandlerSitemapMetadata;
} & (HasNoSvelteProps<SveltePropsOf<Component>> extends true
		? { props?: NoInfer<SveltePropsOf<Component>> }
		: { props: NoInfer<SveltePropsOf<Component>> });

const resolveRequestPathname = (request: Request | undefined) => {
	if (!request) return undefined;

	try {
		const parsed = new URL(request.url);

		return `${parsed.pathname}${parsed.search}`;
	} catch {
		return undefined;
	}
};

export const handleSveltePageRequest = async <
	Component extends SvelteComponent<never>
>(
	input: SveltePageRequestInput<Component>
) => {
	// Dev on-demand pages: `asset()` returned `''` for a page that has not
	// been built yet. Build it now and re-read the manifest; otherwise fall
	// through to the manifest error so the overlay shows the real cause.
	const deferredAssets =
		input.pagePath === '' || input.indexPath === ''
			? await resolveDeferredPageAssets()
			: null;
	const resolvedIndexPath =
		deferredAssets && input.indexPath === ''
			? deferredAssets.lookup(`${deferredAssets.name}Index`)
			: input.indexPath;
	const resolvedOptions = input;
	const resolvedPagePath =
		deferredAssets && input.pagePath === ''
			? deferredAssets.lookup(deferredAssets.name)
			: input.pagePath;
	if (resolvedPagePath === '' || resolvedIndexPath === '') {
		const missingName = deferredAssets?.name || 'Page';
		const missingKey =
			resolvedPagePath === '' ? missingName : `${missingName}Index`;
		throw new Error(`Asset "${missingKey}" not found in manifest.`);
	}
	const userProps = input.props;
	const request = input.request ?? getCurrentAbsoluteRequest();
	const requestPathname = resolveRequestPathname(request);
	// Auto-inject `url` from the request when the caller didn't already
	// pass one in props. Lets users wire `<Router url={url}>` just by
	// forwarding `request` instead of unwrapping it themselves.
	const resolvedProps =
		requestPathname !== undefined &&
		(!isRecord(userProps) || !('url' in userProps))
			? {
					...(userProps ?? {}),
					url: requestPathname
				}
			: userProps;
	const pageId =
		input.__absoluteMobile?.pageId ?? derivePageName(resolvedPagePath);
	const currentContract =
		input.__absoluteMobile?.contract ??
		`svelte:${pageId}:${ABSOLUTE_MOBILE_PAGE_PROTOCOL_VERSION}`;
	const mobileResponse = finalizeAbsoluteMobilePage({
		compatibility: {
			framework: 'svelte',
			pageId,
			representations: [
				{ contract: currentContract, mapProps: (props) => props }
			],
			runtimes: [String(ABSOLUTE_MOBILE_PAGE_PROTOCOL_VERSION)]
		},
		props: resolvedProps ?? Object.create(null),
		request,
		// Web route data: the assets a hovered `<Link>` warms before the
		// click, read back out of the head content this handler is about
		// to render.
		route: () => {
			const head = withDeferredStylesheets(
				input.headContent ?? '',
				deferredAssets
			);
			const title = readHeadTitle(head);

			return {
				assets: {
					css: readHeadStylesheets(head),
					index: resolvedIndexPath
				},
				...(title ? { head: { title } } : {})
			};
		}
	});
	if (mobileResponse) return mobileResponse;

	try {
		const spaNotFound = await renderSpaNotFound(
			'svelte',
			derivePageName(resolvedPagePath),
			request
		);
		if (spaNotFound) return withPageCacheHeaders(spaNotFound, request);
		const handlerCallsite =
			resolvedOptions?.collectStreamingSlots === true
				? undefined
				: (getCurrentRouteRegistrationCallsite() ??
					captureStreamingSlotWarningCallsite());
		const renderPageResponse = async () => {
			const resolvePageComponent =
				async (): Promise<ResolvedSveltePage> => {
					const loadCompiledSourcePath = async (
						sourcePath: string
					): Promise<ResolvedSveltePage> => {
						const compiledModulePath =
							await compileSvelteServerModule(sourcePath);
						const loadedModule: unknown = await import(
							compiledModulePath
						);
						const loadedComponent =
							readDefaultExport(loadedModule) ?? loadedModule;
						if (!isGenericSvelteComponent(loadedComponent)) {
							throw new Error(
								`Invalid compiled Svelte page module: ${sourcePath}`
							);
						}

						return {
							component: loadedComponent,
							hasIslands: readHasIslands(loadedModule)
						};
					};

					const importedPageModule: unknown = await import(
						resolvedPagePath
					);
					const importedPageComponent =
						readDefaultExport(importedPageModule) ??
						importedPageModule;

					if (
						typeof importedPageComponent === 'string' &&
						importedPageComponent.endsWith('.svelte')
					) {
						return loadCompiledSourcePath(importedPageComponent);
					}

					if (!isGenericSvelteComponent(importedPageComponent)) {
						throw new Error(
							`Invalid Svelte page module: ${resolvedPagePath}`
						);
					}

					return {
						component: importedPageComponent,
						hasIslands: readHasIslands(importedPageModule)
					};
				};

			const { renderToReadableStream } = await import(
				'./renderToReadableStream'
			);
			const resolvedPage = await resolvePageComponent();

			// Inline per-page compiled CSS so scoped styles ship in the
			// SSR head instead of loading after client hydration. Bun's
			// .svelte loader emits a sibling .css next to each SSR JS
			// during the server bundle pass; we read it here and stitch
			// it into headContent. See utils/inlinePageCss.
			const siblingCss = await readSiblingCss(resolvedPagePath);
			const cssBlock = siblingCss
				? `<style data-absolute-page-css>${siblingCss}</style>`
				: '';
			const composedHeadContent = `${cssBlock}${withDeferredStylesheets(
				resolvedOptions?.headContent ?? '',
				deferredAssets
			)}`;

			const stream = await renderToReadableStream(
				resolvedPage.component,
				resolvedProps,
				{
					bodyContent: resolvedOptions?.bodyContent,
					bootstrapScriptContent: `${BROWSER_TRANSLATION_BASELINE_SCRIPT}window.__ABS_SLOT_HYDRATION_PENDING__=true;window.__INITIAL_PROPS__=${JSON.stringify(
						resolvedProps
					)};${resolvedIndexPath ? `import(${JSON.stringify(resolvedIndexPath)});` : ''}`,
					headContent: composedHeadContent
				}
			);

			const htmlStream = injectIslandPageContextStream(stream, {
				hasIslands: resolvedPage.hasIslands ? true : undefined
			});
			const { firstChunk, reader } = await primeSvelteStream(htmlStream);

			return new Response(restorePrimedStream(firstChunk, reader), {
				headers: streamingPageHeaders()
			});
		};

		const pageResponse = await runWithStreamingSlotWarningScope(
			() =>
				resolvedOptions?.collectStreamingSlots === true
					? withRegisteredStreamingSlots(renderPageResponse, {
							...resolvedOptions,
							runtimePlacement:
								resolvedOptions.runtimePlacement ?? 'body'
						})
					: renderPageResponse(),
			{ handlerCallsite }
		);

		return withPageCacheHeaders(pageResponse, request, {
			bufferStreamForEtag: input.bufferStreamForEtag
		});
	} catch (error) {
		console.error('[SSR] Svelte render error:', error);

		const pageName = derivePageName(resolvedPagePath);
		const conventionResponse = await renderConventionError(
			'svelte',
			pageName,
			error
		);
		if (conventionResponse) {
			return withPageCacheHeaders(conventionResponse, request);
		}

		return withPageCacheHeaders(
			new Response(ssrErrorPage('svelte', error), {
				headers: { 'Content-Type': 'text/html' },
				status: 500
			}),
			request
		);
	}
};
