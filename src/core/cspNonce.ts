import { registerCspNonceGetter } from '../utils/cspNonceRef';
import { getCurrentAbsoluteRequest } from './requestContext';

/* Per-request Content-Security-Policy nonce.
 *
 * Off until `secureHeaders()` is used. Then every request gets one random
 * nonce (128 bits, base64), created on first use, and every inline <script>
 * and <style> AbsoluteJS writes carries it: page bootstraps, initial props,
 * island state, streaming-slot patches, inline page CSS, speculation rules,
 * the PWA bootstrap and the dev HMR client.
 *
 * The nonce is added where each script is written, never by rewriting the
 * finished HTML: a blanket pass would also bless a <script> injected through
 * `{@html}` / `v-html` / `dangerouslySetInnerHTML`, which is exactly what
 * the policy is there to stop. Your own inline scripts read it with
 * `getCspNonce()` (or `cspNonce` in the Elysia context). */

const NONCE_BYTES = 16;
const NONCES_KEY = Symbol.for('absolutejs.cspNonces');

/* One map per process, not per bundle: dist/index.js and each framework
 * entry carry their own copy of this module. */
const getNonceMap = () => {
	const existing: unknown = Reflect.get(globalThis, NONCES_KEY);
	if (existing instanceof WeakMap) return existing;
	const created = new WeakMap<Request, string>();
	Reflect.set(globalThis, NONCES_KEY, created);

	return created;
};
const ENABLED_KEY = Symbol.for('absolutejs.cspNonceEnabled');

export const createCspNonce = () =>
	Buffer.from(crypto.getRandomValues(new Uint8Array(NONCE_BYTES))).toString(
		'base64'
	);

/** @internal Test hook: turns nonces off again. */
export const disableCspNonces = () => {
	Reflect.deleteProperty(globalThis, ENABLED_KEY);
	registerCspNonceGetter(() => undefined);
};

/** Turns nonces on for this process. Called by `secureHeaders()`; the flag
 *  lives on globalThis so every bundle (dist/index.js, the framework
 *  entries) sees the same state. */
export const enableCspNonces = () => {
	Reflect.set(globalThis, ENABLED_KEY, true);
	registerCspNonceGetter(() => getCspNonce());
};

/** The nonce for `request` (default: the request being handled), or
 *  undefined when `secureHeaders()` isn't in use or there's no request
 *  (build-time rendering). */
export const getCspNonce = (
	request: Request | undefined = getCurrentAbsoluteRequest()
) => {
	if (!request || !isCspNonceEnabled()) return undefined;
	const nonces = getNonceMap();
	const existing: unknown = nonces.get(request);
	if (typeof existing === 'string') return existing;
	const nonce = createCspNonce();
	nonces.set(request, nonce);

	return nonce;
};

export const isCspNonceEnabled = () =>
	Reflect.get(globalThis, ENABLED_KEY) === true;
