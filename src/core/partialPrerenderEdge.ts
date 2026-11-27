import type { StaticPartialConfig } from '../../types/build';
import { streamSlotPayloadLines } from '../utils/streamingSlots';
import { logWarn } from '../utils/logger';
import { reportServerError } from './errorReporter';
import {
	collectHoleSlots,
	type ServePartialPrerenderInput
} from './partialPrerenderServe';
import { asksForSharedCaching, serveValidated } from './prerenderValidators';
import { runWithAbsoluteRequest } from './requestContext';

/* Partial prerendering, edge mode (`static.partial.edge`).
 *
 * Ordinarily a partial page is one response: the cached shell, then its
 * holes streamed into the same document (partialPrerenderServe.ts). The
 * holes are the visitor's, so the response is `private` and no shared
 * cache may keep any of it — every view of the page reaches this
 * server, for a shell that is the same for everyone.
 *
 * Here the two are separate responses:
 *
 * - THE SHELL, alone: the same bytes for every visitor, with a strong
 *   `ETag`, a `304` for a copy that is current, and a public cache
 *   policy. A CDN keeps it and serves it from wherever the visitor is.
 * - THE HOLES, from the same address with `?__absolute_holes`: each
 *   slot's content as a line of JSON, as it resolves, never cached. A
 *   loader in the shell asks for them and hands each to the slot
 *   runtime the shell already carries.
 *
 * Lines of JSON and not the `<script>` patches a document is streamed:
 * a script needs the nonce of the document it lands in, and a stored
 * shell has no nonce of this request's to give. The same reason is why
 * this mode is not served under per-request CSP nonces at all — the
 * shell's own inline scripts would need one too. `prepare()` leaves
 * such an app on the single-response path and says so.
 *
 * The cost is a round trip: the holes start arriving one request later
 * than they would in the same response. Worth it when a CDN turns the
 * shell into a response from next door; a loss when nothing does, which
 * is why it is asked for and not the default. */

/** The query parameter that asks a partial page for its holes. */
export const HOLES_QUERY = '__absolute_holes';

const HOLES_CONTENT_TYPE = 'application/x-ndjson; charset=utf-8';
const CLOSING_BODY = /<\/body>/i;

/* Asks for the holes and gives each line to the slot runtime, which
 * knows how to place a payload (and how to wait for hydration first).
 * The fallback it uses when that runtime is not there yet is the one
 * the document's own patches use. A failure leaves the page as it is:
 * the slots keep their fallbacks, which is what they are for. */
const LOADER = `<script>(function(){var u=new URL(location.href);u.searchParams.set(${JSON.stringify(HOLES_QUERY)},"1");var put=function(l){if(!l)return;var m=JSON.parse(l);(window.__ABS_SLOT_ENQUEUE__||function(i,p){(window.__ABS_SLOT_PENDING__=window.__ABS_SLOT_PENDING__||{})[i]=p})(m.id,m.payload)};fetch(u,{credentials:"same-origin",headers:{accept:"application/x-ndjson"}}).then(function(r){if(!r.ok||!r.body)return;var d=new TextDecoder,b="",rd=r.body.getReader();var pump=function(){return rd.read().then(function(x){b+=d.decode(x.value||new Uint8Array,{stream:!x.done});var p=b.split("\\n");b=p.pop();p.forEach(put);if(x.done){put(b);return}return pump()})};return pump()}).catch(function(e){console.warn("[absolute] this page's dynamic parts could not be loaded:",e)})})();</script>`;

const withLoader = (html: string) => {
	const bodyEnd = html.search(CLOSING_BODY);

	return bodyEnd < 0
		? `${html}${LOADER}`
		: `${html.slice(0, bodyEnd)}${LOADER}${html.slice(bodyEnd)}`;
};

/* Whether `request` is a partial page's loader asking for its holes. */
const isHolesRequest = (request: Request) =>
	new URL(request.url).searchParams.has(HOLES_QUERY);

/* The shell on its own, for any cache to keep (prerenderValidators.ts). */
const serveEdgeShell = (
	filePath: string,
	request: Request,
	edge: StaticPartialConfig['edge']
) =>
	serveValidated({
		filePath,
		kind: 'edge-shell',
		policy: edge,
		request,
		transform: withLoader
	});

/* The request the holes are resolved for: the visitor's, as it would
 * have been without the marker the loader added. */
const withoutMarker = (request: Request) => {
	const url = new URL(request.url);
	url.searchParams.delete(HOLES_QUERY);

	return new Request(url, { headers: request.headers, method: 'GET' });
};

const noHoles = () =>
	new ReadableStream<Uint8Array>({
		start(controller) {
			controller.close();
		}
	});

/* The page's holes, each a line of JSON as it resolves. */
const serveEdgeHoles = (input: ServePartialPrerenderInput) => {
	const request = withoutMarker(input.request);
	const headers = new Headers({
		// The visitor's, and nobody else's.
		'cache-control': 'private, no-store',
		'content-type': HOLES_CONTENT_TYPE,
		'x-absolute-partial-prerender': 'edge-holes'
	});

	/* In the request's context from the first resolver on: a hole that
	 * calls `cookies()` reads this visitor's. */
	return runWithAbsoluteRequest(request, async () => {
		const slots = await collectHoleSlots({ ...input, request }).catch(
			(error: unknown) => {
				console.error(
					'[partial prerender] rendering the holes failed; the shell keeps its fallbacks:',
					error
				);
				reportServerError({ error, kind: 'hole' });

				return [];
			}
		);
		const body =
			slots.length === 0 ? noHoles() : streamSlotPayloadLines(slots);

		return new Response(body, { headers });
	});
};

type Warned = { nonces: boolean };

const warned: Warned = { nonces: false };

/* Once: every partial page of the app is affected alike, and it is a
 * fact about the deployment, not about a request. */
const warnNoncesOnce = () => {
	if (warned.nonces) return;
	warned.nonces = true;
	logWarn(
		'static.partial.edge is set, but this app sends a per-request CSP nonce (secureHeaders()), which a stored page cannot carry. Partial pages are served in one response, uncached, as without it.'
	);
};

/** The response for a partial page in edge mode — the shell, or the
 *  holes when it is the loader asking — and undefined when the page is
 *  to be served the ordinary way: the mode is off, or the app sends
 *  per-request CSP nonces. */
export const edgeResponseFor = (
	input: ServePartialPrerenderInput,
	edge: StaticPartialConfig['edge']
) => {
	if (!asksForSharedCaching(edge)) return undefined;
	if (input.securityHeaders) {
		warnNoncesOnce();

		return undefined;
	}

	return isHolesRequest(input.request)
		? serveEdgeHoles(input)
		: serveEdgeShell(input.filePath, input.request, edge);
};
