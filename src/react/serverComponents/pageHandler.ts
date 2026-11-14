import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { readCspNonce } from '../../utils/cspNonceRef';
import { isProductionRuntime } from '../../utils/runtimeMode';
import { getCurrentAbsoluteRequest } from '../../core/requestContext';
import {
	streamingPageHeaders,
	withPageCacheHeaders
} from '../../core/pageResponseCache';
import {
	type StreamingSlotEnhancerOptions,
	withRegisteredStreamingSlots
} from '../../core/responseEnhancers';
import {
	captureStreamingSlotWarningCallsite,
	runWithStreamingSlotWarningScope
} from '../../core/streamingSlotWarningScope';
import { getCurrentRouteRegistrationCallsite } from '../../core/devRouteRegistrationCallsite';
import { ssrErrorPage } from '../../utils/ssrErrorPage';
import { BROWSER_TRANSLATION_BASELINE_SCRIPT } from '../../core/browserTranslation';
import { REACT_SERVER_RUNTIME_FILE } from './constants';
import { injectFlightPayload } from './flightPayload';

export type ReactServerPageRequestInput<
	Props extends Record<string, unknown> = Record<never, never>
> = StreamingSlotEnhancerOptions & {
	/** Buffer the response so it can carry a content-hash `ETag`. */
	bufferStreamForEtag?: boolean;
	/** Collect streaming slots rendered by the page. On by default; set
	 *  `false` to turn it off (slots then keep their fallback). */
	collectStreamingSlots?: boolean;
	/** `asset(manifest, '<Page>RSC')`: the page's react-server bundle. */
	page: string;
	request?: Request;
} & (keyof Props extends never
		? { props?: NoInfer<Props> }
		: { props: NoInfer<Props> });

type FlightRenderOptions = {
	onError: (error: unknown) => void;
};
type ReactServerPageModule = {
	Page: unknown;
	clientManifest: Record<string, unknown>;
	createElement: (type: unknown, props?: unknown) => unknown;
	renderToReadableStream: (
		model: unknown,
		manifest: Record<string, unknown>,
		options: FlightRenderOptions
	) => ReadableStream<Uint8Array>;
};
type HtmlRenderOptions = {
	bootstrapModules: string[];
	bootstrapScriptContent: string;
	nonce: string | undefined;
	onError: (error: unknown) => void;
};
type ReactServerRendererModule = {
	renderHtml: (
		flight: ReadableStream<Uint8Array>,
		options: HtmlRenderOptions
	) => Promise<ReadableStream<Uint8Array>>;
};
type ReactServerRuntime = { client: string; ssr: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const isPageModule = (value: unknown): value is ReactServerPageModule =>
	isRecord(value) &&
	typeof value.Page === 'function' &&
	isRecord(value.clientManifest) &&
	typeof value.createElement === 'function' &&
	typeof value.renderToReadableStream === 'function';

const isRendererModule = (value: unknown): value is ReactServerRendererModule =>
	isRecord(value) && typeof value.renderHtml === 'function';

const isRuntime = (value: unknown): value is ReactServerRuntime =>
	isRecord(value) &&
	typeof value.client === 'string' &&
	typeof value.ssr === 'string';

const runtimeCache = new Map<string, Promise<ReactServerRuntime>>();

const loadRuntime = async (pagePath: string) => {
	const runtimeDir = dirname(pagePath);
	const parsed: unknown = JSON.parse(
		await readFile(join(runtimeDir, REACT_SERVER_RUNTIME_FILE), 'utf8')
	);
	if (!isRuntime(parsed)) {
		throw new Error(
			`Invalid ${REACT_SERVER_RUNTIME_FILE} in ${runtimeDir}`
		);
	}

	return { client: parsed.client, ssr: join(runtimeDir, parsed.ssr) };
};

/* Production builds never change under a running server; dev rebuilds
 * rewrite the runtime file whenever a client component changes, so it is
 * read per request there. */
const readRuntime = (pagePath: string) => {
	if (!isProductionRuntime()) return loadRuntime(pagePath);
	const cached = runtimeCache.get(pagePath);
	if (cached) return cached;
	const loading = loadRuntime(pagePath);
	runtimeCache.set(pagePath, loading);
	loading.catch(() => runtimeCache.delete(pagePath));

	return loading;
};

const loadPageModule = async (pagePath: string) => {
	const loaded: unknown = await import(pagePath);
	if (!isPageModule(loaded)) {
		throw new Error(
			`${pagePath} is not a React Server Components page bundle. ` +
				'Pass asset(manifest, "<Page>RSC") and give the page a default export.'
		);
	}

	return loaded;
};

const loadRenderer = async (rendererPath: string) => {
	const loaded: unknown = await import(rendererPath);
	if (!isRendererModule(loaded)) {
		throw new Error(
			`${rendererPath} is not a React Server Components renderer.`
		);
	}

	return loaded;
};

const logRenderError = (error: unknown) => {
	console.error('[SSR] React Server Components error:', error);
};

export const handleReactServerPageRequest = async <
	Props extends Record<string, unknown> = Record<never, never>
>(
	input: ReactServerPageRequestInput<Props>
) => {
	const request = input.request ?? getCurrentAbsoluteRequest();
	if (input.page === '') {
		throw new Error(
			'React Server Components page bundle not found in manifest. ' +
				'Is reactServerComponentsDirectory set in absolute.config.ts?'
		);
	}

	try {
		// Slot collection is on unless the handler opts out with `false`:
		// installing the collector costs nothing when no slot registers.
		const collectStreamingSlots = input.collectStreamingSlots !== false;
		const handlerCallsite = collectStreamingSlots
			? undefined
			: (getCurrentRouteRegistrationCallsite() ??
				captureStreamingSlotWarningCallsite());
		const renderPageResponse = async () => {
			const [pageModule, runtime] = await Promise.all([
				loadPageModule(input.page),
				readRuntime(input.page)
			]);
			const renderer = await loadRenderer(runtime.ssr);
			const nonce = readCspNonce();
			const flight = pageModule.renderToReadableStream(
				pageModule.createElement(pageModule.Page, input.props ?? {}),
				pageModule.clientManifest,
				{ onError: logRenderError }
			);
			const [forHtml, forPayload] = flight.tee();
			const html = await renderer.renderHtml(forHtml, {
				bootstrapModules: [runtime.client],
				bootstrapScriptContent: BROWSER_TRANSLATION_BASELINE_SCRIPT,
				nonce,
				onError: logRenderError
			});

			return new Response(injectFlightPayload(html, forPayload, nonce), {
				headers: streamingPageHeaders()
			});
		};

		const pageResponse = await runWithStreamingSlotWarningScope(
			() =>
				collectStreamingSlots
					? withRegisteredStreamingSlots(renderPageResponse, input)
					: renderPageResponse(),
			{ explicitlyDisabled: !collectStreamingSlots, handlerCallsite }
		);

		return withPageCacheHeaders(pageResponse, request, {
			bufferStreamForEtag: input.bufferStreamForEtag
		});
	} catch (error) {
		logRenderError(error);

		return withPageCacheHeaders(
			new Response(ssrErrorPage('react', error), {
				headers: { 'Content-Type': 'text/html' },
				status: 500
			}),
			request
		);
	}
};
