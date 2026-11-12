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
	/** CSP `frame-ancestors`. Default `["'self'"]`; `false` omits it. */
	frameAncestors?: readonly string[] | false;
	/** Feature → allowlist (`[]` disables the feature). `false` omits the
	 *  header. */
	permissionsPolicy?: Record<string, readonly string[]> | false;
	/** Default `strict-origin-when-cross-origin`; `false` omits it. */
	referrerPolicy?: string | false;
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
