import type { App as VueApp, Component as VueComponent } from 'vue';
import { readdir } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import type { VuePropsOf } from '../../types/vue';
import { EXCLUDE_LAST_OFFSET } from '../constants';
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
import { isSsrCacheDirty, markSsrCacheDirty } from '../core/ssrCache';
import { ssrErrorPage } from '../utils/ssrErrorPage';
import {
	derivePageName,
	renderConventionError
} from '../utils/resolveConvention';

type VuePageRenderOptions = StreamingSlotEnhancerOptions & {
	collectStreamingSlots?: boolean;
};
export type VuePageRequestInput<Component extends VueComponent> =
	VuePageRenderOptions & {
		headTag?: `<head>${string}</head>`;
		indexPath: string;
		pagePath: string;
		Page?: Component;
		/** The incoming Elysia request. Forwarded into the page
		 *  module's exported `setupApp(app, { url, isServer })` hook
		 *  (see compileVue's index generation) so plugins like
		 *  vue-router can navigate to the correct route before SSR. */
		request?: Request;
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

type VueSetupAppContext = { url: string; isServer: boolean };
type VueSetupAppHook = (
	app: VueApp,
	ctx: VueSetupAppContext
) => void | Promise<void>;

const readSetupAppHook = (value: unknown): VueSetupAppHook | null => {
	if (!isRecord(value)) return null;
	const setupApp = value['setupApp'];

	return typeof setupApp === 'function'
		? (setupApp as VueSetupAppHook)
		: null;
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

const buildDirtyResponse = (
	headTag: string,
	indexPath: string,
	maybeProps: Record<string, unknown> | undefined
) => {
	const propsScript = `window.__INITIAL_PROPS__=${JSON.stringify(maybeProps ?? {})};`;
	const dirtyFlag = 'window.__SSR_DIRTY__=true;';
	const html =
		`<!DOCTYPE html><html>${headTag}<body><div id="root"></div>` +
		`<script>${propsScript}${dirtyFlag}</script>` +
		`<script type="module" src="${indexPath}"></script>` +
		`</body></html>`;

	return new Response(html, {
		headers: { 'Content-Type': 'text/html' }
	});
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

export const handleVuePageRequest = async <Component extends VueComponent>(
	input: VuePageRequestInput<Component>
) => {
	const passedPageComponent = input.Page;
	const resolvedHeadTag = input.headTag ?? '<head></head>';
	const resolvedIndexPath = input.indexPath;
	const resolvedOptions = input;
	const resolvedPagePath = input.pagePath;
	const maybeProps = input.props;

	if (isSsrCacheDirty('vue')) {
		return buildDirtyResponse(
			resolvedHeadTag,
			resolvedIndexPath,
			maybeProps
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
						setupApp: null as VueSetupAppHook | null
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

			if (resolvedPage.setupApp) {
				const url = resolveRequestRenderUrl(input.request);
				await resolvedPage.setupApp(app, { url, isServer: true });
			}

			const bodyStream = renderToWebStream(app);
			const { firstChunk, reader } = await primeVueStream(bodyStream);

			const head = `<!DOCTYPE html><html>${resolvedHeadTag}<body><div id="root">`;
			const tail = `</div><script>window.__INITIAL_PROPS__=${JSON.stringify(
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

export const invalidateVueSsrCache = () => {
	markSsrCacheDirty('vue');
};
