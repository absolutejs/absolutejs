import type { AnyElysia } from 'elysia';
import { compressHtml } from '../core/compressHtmlResponse';
import {
	compressStream,
	type StreamEncoding
} from '../core/compressPageStream';
import { acceptedEncodings } from '../core/precompressed';
import { logWarn } from '../utils/logger';
import { isDevelopmentRuntime } from '../utils/runtimeMode';

/* Compressing what the app's own routes return: JSON, text, XML.
 *
 *   app
 *   	.use(absolutejs)
 *   	.use(myOwnResponseHook)   // the app's response hooks first
 *   	.use(compressResponses()) // then this
 *   	.get('/api/items', () => items) // and the routes it covers after
 *
 * Opt-in, and mounted by the app where it wants it, because this is the
 * one place compression touches responses the app wrote. Two rules of
 * Elysia's decide where it goes, both measured:
 *
 *   - A response hook reaches only the routes registered after it, and
 *     the plugins and groups mounted after it. A route registered before
 *     is not compressed. In development the plugin says which.
 *   - When a hook replaces a response, the response hooks registered
 *     after it do not run. This replaces the responses it compresses, so
 *     the app's own response hooks belong before it.
 *
 * A replacement keeps the route's status, headers and cookies.
 *
 * Not compressed, whatever the route returns:
 *   - an event stream, or a route written as a generator, which Elysia
 *     turns into a stream; replacing its response ends the stream;
 *   - a page (`text/html`), which the page path compresses or not;
 *   - a body already encoded, or marked `cache-control: no-transform`;
 *   - a `HEAD` request, a range request, a `206`;
 *   - a body under 1 KB, where its size is known, and one that would not
 *     shrink by a tenth;
 *   - anything that is not text: a file, binary data. */

const MIN_COMPRESSIBLE_BYTES = 1024;
const COMPRESSIBLE_TYPE_RE =
	/^(?:text\/(?!html|event-stream)|application\/(?:[\w.+-]*\+)?(?:json|xml|javascript|ecmascript|x-ndjson|graphql-response\+json))/i;
const PARTIAL_CONTENT = 206;
/* The framework's own routes: everything it registers is one of these,
 * or a static file. */
const FRAMEWORK_ROUTE_RE = /^\/(?:_absolute|__absolute|\.absolutejs|hmr)/;
const FILE_ROUTE_RE = /\.[A-Za-z0-9]+$/;
const WARNED_ROUTES = 5;

const isCompressibleType = (type: string | null | undefined) =>
	typeof type === 'string' && COMPRESSIBLE_TYPE_RE.test(type);

const declines = (cacheControl: string | null | undefined) =>
	typeof cacheControl === 'string' && /no-transform/i.test(cacheControl);

type SetHeaders = Record<string, unknown>;

const headerOf = (headers: SetHeaders, name: string) => {
	const value = headers[name];

	return typeof value === 'string' ? value : undefined;
};

/* Elysia turns a generator into a stream of its own. */
const isGenerator = (value: object) => {
	const tag = Object.prototype.toString.call(value);

	return tag === '[object Generator]' || tag === '[object AsyncGenerator]';
};

/* A value Elysia would send as JSON: a plain object or an array. */
const isJsonValue = (value: unknown): value is object =>
	typeof value === 'object' &&
	value !== null &&
	!isGenerator(value) &&
	(Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype);

const encodingFor = (request: Request) => {
	if (request.method === 'HEAD' || request.headers.has('range'))
		return undefined;
	const [preferred] = acceptedEncodings(
		request.headers.get('accept-encoding')
	);
	const encoding: StreamEncoding | undefined =
		preferred?.encoding === 'br' || preferred?.encoding === 'gzip'
			? preferred.encoding
			: undefined;

	return encoding;
};

/* A `Response` the route returned, compressed as it streams: a large
 * one is not read into memory first. */
const compressedResponse = (response: Response, encoding: StreamEncoding) => {
	const { headers } = response;
	if (!response.body || response.status === PARTIAL_CONTENT) return undefined;
	if (headers.has('content-encoding') || headers.has('content-range'))
		return undefined;
	if (declines(headers.get('cache-control'))) return undefined;
	if (!isCompressibleType(headers.get('content-type'))) return undefined;
	const length = Number(headers.get('content-length') ?? Number.NaN);
	if (length < MIN_COMPRESSIBLE_BYTES) return undefined;
	const next = new Headers(headers);
	next.set('content-encoding', encoding);
	next.append('vary', 'Accept-Encoding');
	next.delete('content-length');

	return new Response(compressStream(response.body, encoding), {
		headers: next,
		status: response.status,
		statusText: response.statusText
	});
};

/* A value the route returned, which Elysia would have turned into a
 * body: compressed whole, since it is in hand. */
const compressedValue = async (
	value: unknown,
	encoding: StreamEncoding,
	set: { headers: SetHeaders }
) => {
	if (
		headerOf(set.headers, 'content-encoding') ||
		declines(headerOf(set.headers, 'cache-control'))
	)
		return undefined;
	const declared = headerOf(set.headers, 'content-type');
	const isText = typeof value === 'string';
	if (!isText && !isJsonValue(value)) return undefined;
	const type =
		declared ?? (isText ? 'text/plain; charset=utf-8' : 'application/json');
	if (!isCompressibleType(type)) return undefined;
	const body = isText ? value : JSON.stringify(value);
	if (Buffer.byteLength(body, 'utf-8') < MIN_COMPRESSIBLE_BYTES)
		return undefined;
	const compressed = await compressHtml({ body, encoding });
	if (!compressed) return undefined;
	const vary = headerOf(set.headers, 'vary');

	return new Response(compressed.bytes, {
		headers: {
			'content-encoding': compressed.encoding,
			'content-type': type,
			vary: vary ? `${vary}, Accept-Encoding` : 'Accept-Encoding'
		}
	});
};

const appRoutesBefore = (app: AnyElysia) =>
	app.routes
		.map((route) => `${route.method} ${route.path}`)
		.filter((route) => {
			const path = route.slice(route.indexOf(' ') + 1);

			return !FRAMEWORK_ROUTE_RE.test(path) && !FILE_ROUTE_RE.test(path);
		});

/* In development: the app's routes this cannot reach, because they
 * were registered before it was mounted. */
const warnRoutesBefore = (routes: string[]) => {
	if (routes.length === 0 || !isDevelopmentRuntime()) return;
	const named = routes.slice(0, WARNED_ROUTES).join(', ');
	const more =
		routes.length > WARNED_ROUTES
			? ` and ${routes.length - WARNED_ROUTES} more`
			: '';
	logWarn(
		`compressResponses() was mounted after ${routes.length === 1 ? 'a route' : 'routes'} it does not reach, which are sent uncompressed: ${named}${more}. Mount it before the routes it should cover.`
	);
};

/** Compresses what the routes registered after it return — JSON, text,
 *  XML — for the client that asked, brotli or gzip. Mount it after the
 *  app's own response hooks and before the routes it should cover,
 *  globally or inside a group. See docs/COMPRESSION.md. */
export const compressResponses =
	() =>
	<App extends AnyElysia>(app: App) => {
		warnRoutesBefore(appRoutesBefore(app));

		return app.mapResponse(({ request, responseValue, set }) => {
			const encoding = encodingFor(request);
			if (!encoding) return undefined;
			if (responseValue instanceof Response)
				return compressedResponse(responseValue, encoding);

			return compressedValue(responseValue, encoding, set);
		});
	};
