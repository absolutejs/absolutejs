import type { Component as VueComponent } from 'vue';
import { readdir } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import type { VuePropsOf, VueSetupApp } from '../../types/vue';
import { EXCLUDE_LAST_OFFSET } from '../constants';
import { injectInlineCss, readSiblingCss } from '../utils/inlinePageCss';
import { injectIslandPageContextStream } from '../core/islandPageContext';
import { getCurrentRouteRegistrationCallsite } from '../core/devRouteRegistrationCallsite';
import {
	type StreamingSlotEnhancerOptions,
	withRegisteredStreamingSlots
} from '../core/responseEnhancers';
import {
	captureStreamingSlotWarningCallsite,
	runWithStreamingSlotWarningScope
} from '../core/streamingSlotWarningScope';
import { ssrErrorPage } from '../utils/ssrErrorPage';
import {
	derivePageName,
	renderConventionError
} from '../utils/resolveConvention';

type VuePageRenderOptions = StreamingSlotEnhancerOptions & {
	collectStreamingSlots?: boolean;
};
/** Hydration mode for the page bundle.
 *  - `'auto'` (default): emit `<script>window.__INITIAL_PROPS__=…</script>`
 *    plus the page's `<script type="module">` index, mounting Vue on the
 *    client.
 *  - `'none'`: SSR-only. Skip both scripts entirely so the page ships
 *    pure HTML — useful for marketing / docs pages that use Vue
 *    templating + Tailwind without paying the runtime cost. The build
 *    pipeline also skips emitting the per-page client bundle (and its
 *    manifest entry) when this option is set at registration time —
 *    `scanVueSsrOnlyPages` reads the literal `client: 'none'` token
 *    from the handler source and excludes the matching .vue entry
 *    from the client bundler pass. */
type VuePageClientMode =
	| { client: 'none'; indexPath?: string }
	| { client?: 'auto'; indexPath: string };

export type VuePageRequestInput<Component extends VueComponent> =
	VuePageRenderOptions &
		VuePageClientMode & {
			headTag?: `<head>${string}</head>`;
			pagePath: string;
			Page?: Component;
			/** The incoming Elysia request. Forwarded into the page
			 *  module's exported `setupApp(app, { url, isServer })` hook
			 *  (see compileVue's index generation) so plugins like
			 *  vue-router can navigate to the correct route before SSR. */
			request?: Request;
			/** Sitemap metadata for this route. Statically read from the
			 *  handler source at registration time, so only literal-object
			 *  values are honoured. */
			sitemap?: import('../../types/sitemap').PageHandlerSitemapMetadata;
		} & (keyof VuePropsOf<Component> extends never
			? { props?: NoInfer<VuePropsOf<Component>> }
			: { props: NoInfer<VuePropsOf<Component>> });
type GenericVueComponent = VueComponent;
const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const isGenericVueComponent = (value: unknown): value is GenericVueComponent =>
	typeof value === 'function' || isRecord(value);

const readHasIslands = (value: unknown) => {
	if (!isRecord(value)) return false;
	const hasIslands = value['__ABSOLUTE_PAGE_HAS_ISLANDS__'];

	return typeof hasIslands === 'boolean' ? hasIslands : false;
};

const readSetupAppHook = (value: unknown): VueSetupApp | null => {
	if (!isRecord(value)) return null;
	const setupApp = value['setupApp'];

	return typeof setupApp === 'function' ? (setupApp as VueSetupApp) : null;
};

const readDefaultExport = (value: unknown) =>
	isRecord(value) ? value.default : undefined;

const resolveCurrentGeneratedVueModulePath = async (pagePath: string) => {
	const pageDirectory = dirname(pagePath);
	const expectedPrefix = `${basename(pagePath, '.js').split('.')[0]}.`;

	try {
		const pageEntries = await readdir(pageDirectory, {
			withFileTypes: true
		});
		const matchingEntry = pageEntries.find(
			(entry) =>
				entry.isFile() &&
				entry.name.endsWith('.js') &&
				(entry.name ===
					`${expectedPrefix.slice(0, EXCLUDE_LAST_OFFSET)}.js` ||
					entry.name.startsWith(expectedPrefix))
		);
		if (!matchingEntry) {
			return pagePath;
		}

		return `${pageDirectory}/${matchingEntry.name}`;
	} catch {
		return pagePath;
	}
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

const primeVueStream = async (stream: ReadableStream) => {
	const reader = stream.getReader();
	const firstChunk = await reader.read();

	return { firstChunk, reader };
};

/* Dev-only: SSR-only Vue pages (`client: 'none'`) ship zero client JS by
 *  design, which also means no WebSocket listener for HMR. To keep the
 *  developer loop alive without reintroducing a framework runtime, inject
 *  the same inlined HMR client bundle that HTML/HTMX pages get at build
 *  time (see `injectHMRIntoHTMLFile` in `src/core/build.ts`). The bundle
 *  is built lazily on first SSR-only request and cached for the life of
 *  the dev server. Production builds never call this path. */
let cachedSsrOnlyHmrShim: Promise<string> | null = null;

const getSsrOnlyHmrShim = () => {
	if (cachedSsrOnlyHmrShim) return cachedSsrOnlyHmrShim;
	cachedSsrOnlyHmrShim = (async () => {
		const { buildHMRClient } = await import('../dev/buildHMRClient');
		const bundle = await buildHMRClient();

		return `<script>window.__HMR_FRAMEWORK__="vue";</script><script data-hmr-client>${bundle}</script>`;
	})();

	return cachedSsrOnlyHmrShim;
};

export const handleVuePageRequest = async <Component extends VueComponent>(
	input: VuePageRequestInput<Component>
) => {
	const passedPageComponent = input.Page;
	const userHeadTag = input.headTag ?? '<head></head>';
	const resolvedOptions = input;
	const resolvedPagePath = input.pagePath;
	// Inline per-page compiled CSS so scoped styles ship in the SSR head
	// instead of loading after client hydration. See utils/inlinePageCss.
	const siblingCss = await readSiblingCss(resolvedPagePath);
	const resolvedHeadTag = injectInlineCss(userHeadTag, siblingCss);
	const maybeProps = input.props;
	const clientMode: 'auto' | 'none' = input.client ?? 'auto';
	const resolvedIndexPath = input.indexPath;
	if (clientMode === 'auto' && !resolvedIndexPath) {
		throw new Error(
			'handleVuePageRequest: `indexPath` is required when `client` is `"auto"` (the default). Pass `client: "none"` to ship a SSR-only page with no client bundle.'
		);
	}

	try {
		const handlerCallsite =
			resolvedOptions?.collectStreamingSlots === true
				? undefined
				: (getCurrentRouteRegistrationCallsite() ??
					captureStreamingSlotWarningCallsite());
		const renderPageResponse = async () => {
			const resolvePageComponent = async () => {
				if (isGenericVueComponent(passedPageComponent)) {
					return {
						component: passedPageComponent,
						hasIslands: readHasIslands(passedPageComponent),
						routes: null as unknown[] | null,
						setupApp: null as VueSetupApp | null
					};
				}

				const generatedPagePath =
					await resolveCurrentGeneratedVueModulePath(
						resolvedPagePath
					);
				const importedPageModule: unknown = await import(
					generatedPagePath
				);
				const importedPageComponent =
					readDefaultExport(importedPageModule) ?? importedPageModule;
				if (!isGenericVueComponent(importedPageComponent)) {
					throw new Error(
						`Invalid Vue page module: ${generatedPagePath}`
					);
				}

				return {
					component: importedPageComponent,
					hasIslands: readHasIslands(importedPageModule),
					setupApp: readSetupAppHook(importedPageModule)
				};
			};

			const resolvedPage = await resolvePageComponent();
			const { createSSRApp, h } = await import('vue');
			const { renderToWebStream } = await import('vue/server-renderer');

			const app = createSSRApp({
				render: () => h(resolvedPage.component, maybeProps ?? null)
			});

			let pendingRedirect: { location: string; status: number } | null =
				null;
			if (resolvedPage.setupApp) {
				const url = resolveRequestRenderUrl(input.request);
				// `router` is null here — when the page exports `routes`, the
				// auto-wrapper compileVue injects creates the router using the
				// page's bundled vue-router and rebinds ctx.router before
				// calling the user's setupApp. The runtime never sees its own
				// vue-router instance; that's by design — vue-router is
				// inlined in the page bundle, so a separate runtime instance
				// would carry mismatched provide/inject symbols.
				await resolvedPage.setupApp(app, {
					isServer: true,
					router: null,
					setRedirect: (location, status) => {
						pendingRedirect = {
							location,
							status: status ?? 302
						};
					},
					url
				});
			}

			if (pendingRedirect !== null) {
				const redirect: { location: string; status: number } =
					pendingRedirect;

				return new Response(null, {
					headers: { Location: redirect.location },
					status: redirect.status
				});
			}

			const bodyStream = renderToWebStream(app);
			const { firstChunk, reader } = await primeVueStream(bodyStream);

			const head = `<!DOCTYPE html><html>${resolvedHeadTag}<body><div id="root">`;
			const ssrOnlyHmrShim =
				clientMode === 'none' && process.env.NODE_ENV === 'development'
					? await getSsrOnlyHmrShim()
					: '';
			const tail =
				clientMode === 'none'
					? `</div>${ssrOnlyHmrShim}</body></html>`
					: `</div><script>window.__INITIAL_PROPS__=${JSON.stringify(
							maybeProps ?? {}
						)}</script><script type="module" src="${resolvedIndexPath}"></script></body></html>`;

			const stream = new ReadableStream({
				start(controller) {
					controller.enqueue(head);
					if (!firstChunk.done) {
						controller.enqueue(firstChunk.value);
					}
					if (firstChunk.done) {
						controller.enqueue(tail);
						controller.close();

						return;
					}
					const pumpLoop = () => {
						reader
							.read()
							.then(({ done, value }) =>
								done
									? (controller.enqueue(tail),
										controller.close())
									: (controller.enqueue(value), pumpLoop())
							)
							.catch((err) => controller.error(err));
					};
					pumpLoop();
				}
			});
			const htmlStream = injectIslandPageContextStream(stream, {
				hasIslands: resolvedPage.hasIslands
			});

			return new Response(htmlStream, {
				headers: { 'Content-Type': 'text/html' }
			});
		};

		return await runWithStreamingSlotWarningScope(
			() =>
				resolvedOptions?.collectStreamingSlots === true
					? withRegisteredStreamingSlots(
							renderPageResponse,
							resolvedOptions
						)
					: renderPageResponse(),
			{ handlerCallsite }
		);
	} catch (error) {
		console.error('[SSR] Vue render error:', error);

		const pageName = derivePageName(resolvedPagePath);
		const conventionResponse = await renderConventionError(
			'vue',
			pageName,
			error
		);
		if (conventionResponse) return conventionResponse;

		return new Response(ssrErrorPage('vue', error), {
			headers: { 'Content-Type': 'text/html' },
			status: 500
		});
	}
};
