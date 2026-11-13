import {
	appendStreamingSlotPatchesToStream,
	type StreamingSlot
} from '../utils/streamingSlots';
import { collectPartialHoles } from './partialPrerender';
import { servePrerenderedPage } from './prerenderNonce';
import { runWithAbsoluteRequest } from './requestContext';

/* Partial prerendering: the serving half.
 *
 * A pre-rendered page captured with dynamic holes has `<page>.holes` next
 * to it (partialPrerender.ts). Serving it sends the cached shell
 * at once, then renders the route in-process (bypassing the cache, with
 * the visitor's headers and cookies) only to collect its dynamic slots,
 * resolves those and streams their patches into the open document before
 * `</body></html>`. Static slots are already in the shell and never
 * resolve again.
 *
 * The patches carry this request's CSP nonce, the same one the shell is
 * restamped with (prerenderNonce.ts). */

const CLOSING_PAGE_TAG_REGEX = /<\/body>\s*<\/html>\s*$/i;

type AppHandle = (request: Request) => Promise<Response> | Response;

export type ServePartialPrerenderInput = {
	/** The route's pre-rendered shell. */
	filePath: string;
	/** The app's request handler, used to render the route's holes. */
	handle: AppHandle;
	/** Dynamic slot ids the shell was captured with. */
	holes: string[];
	/** Header that makes the app skip the pre-render cache. */
	bypassHeader: string;
	request: Request;
	/** This request's CSP nonce and security headers under secureHeaders(). */
	nonce?: string;
	securityHeaders?: Record<string, string>;
};

const readShell = async (
	filePath: string,
	nonce: string | undefined,
	securityHeaders: Record<string, string> | undefined
) => {
	if (nonce && securityHeaders) {
		const { dropHeaders, response } = await servePrerenderedPage(
			filePath,
			nonce,
			securityHeaders
		);

		return {
			dropHeaders,
			headers: new Headers(response.headers),
			html: await response.text()
		};
	}

	return {
		dropHeaders: [],
		headers: new Headers(),
		html: await Bun.file(filePath).text()
	};
};

const holesRequest = (request: Request, bypassHeader: string) => {
	const headers = new Headers(request.headers);
	headers.set(bypassHeader, '1');
	headers.delete('if-none-match');
	headers.delete('if-modified-since');

	return new Request(request.url, { headers, method: 'GET' });
};

const collectHoleSlots = async (input: ServePartialPrerenderInput) => {
	const inner = holesRequest(input.request, input.bypassHeader);
	const { response, slots } = await collectPartialHoles(() =>
		runWithAbsoluteRequest(inner, () => input.handle(inner))
	);
	await response.body?.cancel().catch(() => undefined);

	const collected: StreamingSlot[] = slots ?? [];

	return collected.filter((slot) => input.holes.includes(slot.id));
};

const pipeInto = async (
	source: ReadableStream<Uint8Array>,
	controller: ReadableStreamDefaultController<Uint8Array>
) => {
	const reader = source.getReader();
	const pump = async (): Promise<void> => {
		const { done, value } = await reader.read();
		if (done) return;
		controller.enqueue(value);
		await pump();
	};
	await pump();
};

const emptyStream = () =>
	new ReadableStream<Uint8Array>({
		start(controller) {
			controller.close();
		}
	});

const streamHoles = async (
	input: ServePartialPrerenderInput,
	controller: ReadableStreamDefaultController<Uint8Array>
) => {
	const slots = await collectHoleSlots(input).catch((error: unknown) => {
		console.error(
			'[partial prerender] rendering the holes failed; the shell keeps its fallbacks:',
			error
		);

		return [];
	});
	if (slots.length === 0) return;
	const patches = appendStreamingSlotPatchesToStream(emptyStream(), slots, {
		injectRuntime: false,
		nonce: input.nonce
	});
	await pipeInto(new Response(patches).body ?? emptyStream(), controller);
};

/** The response for a partially pre-rendered page: the cached shell at
 *  once, its dynamic holes streamed in as they resolve. Returns the headers
 *  to drop when the shell can't be served under the CSP (see
 *  servePrerenderedPage). */
export const servePartialPrerender = async (
	input: ServePartialPrerenderInput
) => {
	const { dropHeaders, headers, html } = await readShell(
		input.filePath,
		input.nonce,
		input.securityHeaders
	);
	const tailStart = html.search(CLOSING_PAGE_TAG_REGEX);
	const head = tailStart < 0 ? html : html.slice(0, tailStart);
	const tail = tailStart < 0 ? '' : html.slice(tailStart);
	const encoder = new TextEncoder();
	const { request } = input;
	const body = new ReadableStream<Uint8Array>({
		start: (controller) =>
			runWithAbsoluteRequest(request, async () => {
				controller.enqueue(encoder.encode(head));
				await streamHoles(input, controller);
				controller.enqueue(encoder.encode(tail));
				controller.close();
			}).catch((error: unknown) => controller.error(error))
	});
	headers.set('content-type', 'text/html; charset=utf-8');
	// The holes are per request: shared caches must not store the document.
	headers.set('cache-control', 'private, no-cache');
	headers.set('x-absolute-partial-prerender', 'shell');

	return { dropHeaders, response: new Response(body, { headers }) };
};
