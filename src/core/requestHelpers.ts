/* `headers()` and `cookies()`: the current request, from anywhere.
 *
 * A route handler is handed its request. A function three calls below it
 * is not — a data loader, a guard, a component rendering on the server —
 * and threading the request down to each one is the plumbing these
 * remove. The framework already tracks the request for the length of its
 * handling (it is how a page handler finds the CSP nonce), so both are a
 * read of that.
 *
 * COOKIES WRITTEN here are queued on the request and added to the
 * response as it leaves, which has one hard edge: once the response has
 * been handed over there is no header left for a cookie to travel in. On
 * a streamed page that moment comes before the page has finished
 * rendering, so a cookie set from a part of the page that streams in
 * late would be silently lost. It throws instead.
 *
 * The defaults lean safe, because a cookie's attributes are the kind of
 * thing nobody revisits: `HttpOnly`, `SameSite=Lax`, `Path=/`, and
 * `Secure` whenever the request itself came over HTTPS.
 *
 * There is no session helper beside these on purpose. `@absolutejs/auth`
 * owns sessions, guest sessions included; a second one here, held in a
 * cookie instead of a store, would be a different thing under the same
 * name. */

import type {
	CookieOptions,
	ReadonlyRequestHeaders,
	RequestCookies
} from '../../types/requestHelpers';
import { isHttpsRequest } from '../utils/isHttpsRequest';
import { recordRequestRead, wantsCacheTags } from './cacheTags';
import {
	type AbsoluteRequestStore,
	getAbsoluteRequestStore,
	type QueuedCookie
} from './requestContext';

/* RFC 6265's cookie-name: an HTTP token. */
const COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
/* What may not appear in an attribute value: it would end the attribute
 * or the header. */
const ATTRIBUTE_BREAK = /[;\r\n]/;
const EPOCH = 'Thu, 01 Jan 1970 00:00:00 GMT';
const DEFAULT_PATH = '/';

const storeFor = (helper: string) => {
	const store = getAbsoluteRequestStore();
	if (!store)
		throw new Error(
			`${helper}() was called outside a request. It reads the request the framework is handling, so it works inside a route handler, a loader, a guard or a server render, in an app that mounts the plugin prepare() returns. At module scope, in a timer or after the response there is no request to read.`
		);

	return store;
};

/* The same headers, noting what is asked of them. Used only while a
 * page is being pre-rendered, where a read of the request is a mistake
 * worth reporting (cacheTags.ts); a visitor's request gets the plain
 * object. */
const NAMED_READS = new Set<string | symbol>(['get', 'has']);
const UNRECORDED = new Set<string | symbol>(['getSetCookie']);

const noteHeaderRead = (
	store: AbsoluteRequestStore,
	method: string | symbol,
	args: unknown[]
) => {
	if (UNRECORDED.has(method)) return;
	const [name] = args;
	if (NAMED_READS.has(method) && typeof name === 'string')
		recordRequestRead(
			store,
			`headers().${String(method)}('${name.toLowerCase()}')`
		);
	// Listing them all reads every one.
	else recordRequestRead(store, 'headers()');
};

/* A proxy rather than a hand-written copy: it is the request's own
 * `Headers` in every respect, with each call noted on the way. */
const notingReads = (store: AbsoluteRequestStore) => {
	const noting: ReadonlyRequestHeaders = new Proxy(store.request.headers, {
		get: (target, property) => {
			const member: unknown = Reflect.get(target, property, target);
			if (typeof member !== 'function') return member;

			return (...args: unknown[]) => {
				noteHeaderRead(store, property, args);

				return Reflect.apply(member, target, args);
			};
		}
	});

	return noting;
};

const isPrerenderCapture = (store: AbsoluteRequestStore) => {
	store.isPrerenderCapture ??= wantsCacheTags(store.request);

	return store.isPrerenderCapture;
};

/** The current request's headers. */
export const headers = () => {
	const store = storeFor('headers');
	if (isPrerenderCapture(store)) return notingReads(store);
	const readable: ReadonlyRequestHeaders = store.request.headers;

	return readable;
};

const safeDecode = (value: string) => {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
};

const unquote = (value: string) =>
	value.length > 1 && value.startsWith('"') && value.endsWith('"')
		? value.slice(1, -1)
		: value;

/* The first occurrence of a name wins, as browsers send the most
 * specific path first. */
const parseCookieHeader = (header: string | null) => {
	const parsed = new Map<string, string>();
	(header ?? '').split(';').forEach((pair) => {
		const separator = pair.indexOf('=');
		if (separator < 0) return;
		const name = pair.slice(0, separator).trim();
		if (name === '' || parsed.has(name)) return;
		parsed.set(name, safeDecode(unquote(pair.slice(separator + 1).trim())));
	});

	return parsed;
};

const requestCookiesOf = (store: AbsoluteRequestStore) => {
	store.requestCookies ??= parseCookieHeader(
		store.request.headers.get('cookie')
	);

	return store.requestCookies;
};

const assertName = (name: string) => {
	if (!COOKIE_NAME.test(name))
		throw new TypeError(
			`"${name}" is not a valid cookie name. A name may hold letters, digits and !#$%&'*+-.^_\`|~, with no spaces, "=" or ";".`
		);
};

const assertAttribute = (label: string, value: string | undefined) => {
	if (value !== undefined && ATTRIBUTE_BREAK.test(value))
		throw new TypeError(
			`A cookie's ${label} may not contain ";" or a line break.`
		);
};

const sameSiteAttribute = (sameSite: CookieOptions['sameSite']) => {
	if (sameSite === 'none') return 'None';
	if (sameSite === 'strict') return 'Strict';

	return 'Lax';
};

const lifetimeAttributes = (options: CookieOptions) => {
	if (options.maxAge !== undefined) {
		if (!Number.isFinite(options.maxAge))
			throw new TypeError('A cookie maxAge must be a number of seconds.');

		return [`Max-Age=${Math.trunc(options.maxAge)}`];
	}

	return options.expires ? [`Expires=${options.expires.toUTCString()}`] : [];
};

const attributesOf = (
	name: string,
	options: CookieOptions,
	request: Request
) => {
	assertName(name);
	assertAttribute('path', options.path);
	assertAttribute('domain', options.domain);
	const secure = options.secure ?? isHttpsRequest(request);
	if (options.sameSite === 'none' && !secure)
		throw new TypeError(
			`The cookie "${name}" has sameSite "none" without secure. Browsers reject that cookie outright, so it would never be stored.`
		);

	return [
		`Path=${options.path ?? DEFAULT_PATH}`,
		...(options.domain ? [`Domain=${options.domain}`] : []),
		...lifetimeAttributes(options),
		...((options.httpOnly ?? true) ? ['HttpOnly'] : []),
		...(secure ? ['Secure'] : []),
		`SameSite=${sameSiteAttribute(options.sameSite)}`,
		...(options.partitioned ? ['Partitioned'] : [])
	];
};

/* A browser tells cookies apart by name, domain and path together. */
const cookieKey = (
	name: string,
	options: Pick<CookieOptions, 'domain' | 'path'>
) => `${name}\n${options.domain ?? ''}\n${options.path ?? DEFAULT_PATH}`;

const queue = (
	store: AbsoluteRequestStore,
	options: Pick<CookieOptions, 'domain' | 'path'>,
	cookie: QueuedCookie
) => {
	if (store.responseStarted)
		throw new Error(
			`The cookie "${cookie.name}" was set after the response had started. Its headers are already on their way, so the cookie would never be sent. Set it before the page streams: in the route handler, a guard or a loader, not in a part of the page that renders late.`
		);
	store.responseCookies ??= new Map();
	store.responseCookies.set(cookieKey(cookie.name, options), cookie);
};

/* What a read should report: a cookie set earlier in this request is the
 * cookie, even though the browser has not seen it yet, and one deleted
 * earlier is gone. */
const currentValues = (store: AbsoluteRequestStore) => {
	const values = new Map(requestCookiesOf(store));
	store.responseCookies?.forEach(({ name, value }) => {
		if (value === undefined) values.delete(name);
		else values.set(name, value);
	});

	return values;
};

/** The current request's cookies, and a way to set them on its response. */
export const cookies = () => {
	const store = storeFor('cookies');
	const jar: RequestCookies = {
		delete: (name, options = {}) => {
			/* Both ways of saying "expired": Max-Age for every current
			 * browser, Expires for anything that predates it. */
			const attributes = attributesOf(
				name,
				{ ...options, maxAge: 0 },
				store.request
			);
			queue(store, options, {
				name,
				serialized: [
					`${name}=`,
					...attributes,
					`Expires=${EPOCH}`
				].join('; '),
				value: undefined
			});
		},
		get: (name) => {
			recordRequestRead(store, `cookies().get('${name}')`);

			return currentValues(store).get(name);
		},
		getAll: () => {
			recordRequestRead(store, 'cookies().getAll()');

			return Object.fromEntries(currentValues(store));
		},
		has: (name) => {
			recordRequestRead(store, `cookies().has('${name}')`);

			return currentValues(store).has(name);
		},
		set: (name, value, options = {}) => {
			const attributes = attributesOf(name, options, store.request);
			queue(store, options, {
				name,
				serialized: [
					`${name}=${encodeURIComponent(value)}`,
					...attributes
				].join('; '),
				value
			});
		}
	};

	return jar;
};
