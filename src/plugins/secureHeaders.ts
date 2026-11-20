import { Elysia } from 'elysia';
import {
	disableCspNonces,
	enableCspNonces,
	getCspNonce
} from '../core/cspNonce';
import { isDevelopmentRuntime } from '../utils/runtimeMode';

/* Opt-in security headers with a per-request CSP nonce.
 *
 *   new Elysia().use(secureHeaders()).use(absolutejs)
 *
 * The default policy allows scripts only by nonce plus 'strict-dynamic'
 * (no 'unsafe-inline'), so a script AbsoluteJS writes runs and anything it
 * loads runs, while injected markup doesn't. Every directive and header
 * can be overridden or turned off. In development the policy also allows
 * the HMR WebSocket and 'unsafe-eval' (Angular's dev JIT); production is
 * unchanged by that. */

/** Directive name → sources. `false` removes a default directive. */
export type CspDirectives = Record<string, readonly string[] | false>;

export type SecureHeadersOptions = {
	/** `false` sends no Content-Security-Policy. */
	contentSecurityPolicy?:
		| false
		| {
				/** Merged over the defaults, directive by directive. */
				directives?: CspDirectives;
				/** Send `Content-Security-Policy-Report-Only` instead. */
				reportOnly?: boolean;
		  };
	/** `X-Content-Type-Options: nosniff`. Default on. */
	contentTypeOptions?: boolean;
	/** `Cross-Origin-Opener-Policy`. Default
	 *  `same-origin-allow-popups`, not `same-origin`: full isolation
	 *  severs `window.opener`, which breaks an OAuth popup mid-flow.
	 *  `false` omits the header. */
	crossOriginOpenerPolicy?: string | false;
	/** `Cross-Origin-Resource-Policy`. Default `same-site`, not
	 *  `same-origin`: an app serving its own assets from a CDN subdomain
	 *  is the common case, and `same-origin` blocks it. `false` omits the
	 *  header. */
	crossOriginResourcePolicy?: string | false;
	/** CSP `frame-ancestors`. Default `["'self'"]`; `false` omits it. */
	frameAncestors?: readonly string[] | false;
	/** Feature → allowlist (`[]` disables the feature). `false` omits the
	 *  header. */
	permissionsPolicy?: Record<string, readonly string[]> | false;
	/** `Strict-Transport-Security`, off by default.
	 *
	 *  Off because it is sticky: once a browser has it, that host is
	 *  HTTPS-only until the max-age expires, and `includeSubDomains` or
	 *  `preload` cannot be walked back by changing the header — an
	 *  HTTP-only staging subdomain becomes unreachable for visitors who
	 *  saw it once.
	 *
	 *  `true` sends `max-age=15552000` (180 days) with neither flag.
	 *  Only sent to a request that arrived over HTTPS, directly or
	 *  through a proxy that said so. */
	hsts?:
		| boolean
		| {
				includeSubDomains?: boolean;
				/** Seconds. Default 15552000 (180 days). */
				maxAge?: number;
				/** Submits the host to browsers' preload list, which is
				 *  effectively permanent. Never on by default. */
				preload?: boolean;
		  };
	/** Default `strict-origin-when-cross-origin`; `false` omits it. */
	referrerPolicy?: string | false;
};

const DEFAULT_HSTS_MAX_AGE = 15_552_000;

/* A proxy that terminates TLS forwards plain HTTP, so the request's own
 * URL says `http:` on most real deployments. The first value of
 * `x-forwarded-proto` is the client's protocol; later ones are hops. */
const isHttps = (request: Request) => {
	if (new URL(request.url).protocol === 'https:') return true;
	const forwarded = request.headers.get('x-forwarded-proto');

	return (forwarded?.split(',')[0] ?? '').trim().toLowerCase() === 'https';
};

const hstsHeader = (hsts: SecureHeadersOptions['hsts']) => {
	if (!hsts) return undefined;
	const options = hsts === true ? {} : hsts;

	return [
		`max-age=${options.maxAge ?? DEFAULT_HSTS_MAX_AGE}`,
		...(options.includeSubDomains ? ['includeSubDomains'] : []),
		...(options.preload ? ['preload'] : [])
	].join('; ');
};

const DEFAULT_DIRECTIVES: Record<string, readonly string[]> = {
	'base-uri': ["'self'"],
	'connect-src': ["'self'"],
	'default-src': ["'self'"],
	'font-src': ["'self'", 'data:'],
	'form-action': ["'self'"],
	'img-src': ["'self'", 'data:', 'blob:'],
	'manifest-src': ["'self'"],
	'object-src': ["'none'"],
	'script-src': ["'self'", "'strict-dynamic'"],
	'style-src': ["'self'"],
	// Frameworks write style="" attributes (Vue :style, Svelte style:);
	// they can't run script.
	'style-src-attr': ["'unsafe-inline'"],
	'worker-src': ["'self'", 'blob:']
};

const DEFAULT_PERMISSIONS_POLICY: Record<string, readonly string[]> = {
	camera: [],
	geolocation: [],
	microphone: [],
	payment: [],
	usb: []
};

/** Directives that get the request's nonce. */
const NONCE_DIRECTIVES = ['script-src', 'style-src'];

/* Development only: Angular's dev build compiles with eval (JIT). */
const DEV_SCRIPT_SOURCES = ["'unsafe-eval'"];

const devConnectSources = (request: Request) => {
	const { host } = new URL(request.url);

	return [`ws://${host}`, `wss://${host}`];
};

export const buildContentSecurityPolicy = (
	directives: CspDirectives,
	nonce: string | undefined,
	extraConnectSources: readonly string[] = [],
	extraScriptSources: readonly string[] = []
) =>
	Object.entries(directives)
		.flatMap(([name, sources]) => {
			if (sources === false) return [];
			const withNonce =
				nonce && NONCE_DIRECTIVES.includes(name)
					? [...sources, `'nonce-${nonce}'`]
					: sources;
			const extra: Record<string, readonly string[]> = {
				'connect-src': extraConnectSources,
				'script-src': extraScriptSources
			};
			const all = [...withNonce, ...(extra[name] ?? [])];

			return [`${name} ${all.join(' ')}`.trim()];
		})
		.join('; ');

const serializePermissionsPolicy = (
	policy: Record<string, readonly string[]>
) =>
	Object.entries(policy)
		.map(([feature, allowlist]) => `${feature}=(${allowlist.join(' ')})`)
		.join(', ');

const resolveDirectives = (options: SecureHeadersOptions) => {
	const csp = options.contentSecurityPolicy;
	const frameAncestors = options.frameAncestors ?? ["'self'"];
	const directives: CspDirectives = {
		...DEFAULT_DIRECTIVES,
		'frame-ancestors': frameAncestors,
		...(csp ? csp.directives : {})
	};

	return directives;
};

/** The headers `secureHeaders(options)` sends for `request`. */
export const securityHeadersFor = (
	request: Request,
	options: SecureHeadersOptions = {}
) => {
	const headers: Record<string, string> = {};
	if (options.contentTypeOptions !== false)
		headers['x-content-type-options'] = 'nosniff';
	if (options.referrerPolicy !== false)
		headers['referrer-policy'] =
			options.referrerPolicy ?? 'strict-origin-when-cross-origin';
	if (options.permissionsPolicy !== false)
		headers['permissions-policy'] = serializePermissionsPolicy(
			options.permissionsPolicy ?? DEFAULT_PERMISSIONS_POLICY
		);
	if (options.crossOriginOpenerPolicy !== false)
		headers['cross-origin-opener-policy'] =
			options.crossOriginOpenerPolicy ?? 'same-origin-allow-popups';
	if (options.crossOriginResourcePolicy !== false)
		headers['cross-origin-resource-policy'] =
			options.crossOriginResourcePolicy ?? 'same-site';
	// Sent only over HTTPS: a browser ignores it on plain HTTP, and
	// sending it there claims a guarantee this connection did not keep.
	const hsts = isHttps(request) ? hstsHeader(options.hsts) : undefined;
	if (hsts) headers['strict-transport-security'] = hsts;
	const csp = options.contentSecurityPolicy;
	if (csp === false) return headers;
	const policy = buildContentSecurityPolicy(
		resolveDirectives(options),
		getCspNonce(request),
		isDevelopmentRuntime() ? devConnectSources(request) : [],
		isDevelopmentRuntime() ? DEV_SCRIPT_SOURCES : []
	);
	const header = csp?.reportOnly
		? 'content-security-policy-report-only'
		: 'content-security-policy';
	headers[header] = policy;

	return headers;
};

const HEADERS_KEY = Symbol.for('absolutejs.secureHeadersFor');

const isStringRecord = (value: unknown): value is Record<string, string> =>
	typeof value === 'object' &&
	value !== null &&
	Object.values(value).every((entry) => typeof entry === 'string');

/** The headers the active `secureHeaders()` plugin sends for `request`, or
 *  null without one. For responses produced before the plugin's hook runs
 *  (pre-rendered pages). */
export const activeSecurityHeadersFor = (request: Request) => {
	const build: unknown = Reflect.get(globalThis, HEADERS_KEY);
	if (typeof build !== 'function') return null;
	const headers: unknown = build(request);

	return isStringRecord(headers) ? headers : null;
};

/** @internal Test hook: forgets the active plugin and turns nonces off. */
export const resetSecureHeaders = () => {
	Reflect.deleteProperty(globalThis, HEADERS_KEY);
	disableCspNonces();
};

export const secureHeaders = (options: SecureHeadersOptions = {}) => {
	if (options.contentSecurityPolicy !== false) enableCspNonces();
	Reflect.set(globalThis, HEADERS_KEY, (request: Request) =>
		securityHeadersFor(request, options)
	);

	return new Elysia({ name: 'absolutejs-secure-headers', seed: options })
		.onRequest(({ request, set }) => {
			Object.assign(set.headers, securityHeadersFor(request, options));
		})
		.derive('global', ({ request }) => ({
			/** This request's CSP nonce, for your own inline scripts. */
			cspNonce: getCspNonce(request)
		}))
		.as('global');
};
