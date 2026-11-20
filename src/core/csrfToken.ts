import {
	constantTimeEquals,
	signValue,
	signingSecret,
	verifyValue
} from '../utils/signingSecret';
import {
	CSRF_COOKIE_NAME,
	CSRF_FIELD_NAME,
	CSRF_HEADER_NAME,
	registerCsrfTokenGetter
} from '../utils/csrfTokenRef';
import { getCurrentAbsoluteRequest } from './requestContext';

/** Signed double-submit CSRF tokens for `form` routes.
 *
 *  Phase 1's protection is the header check in formActions.ts, which is on
 *  by default and enough for a browser that sends `Sec-Fetch-Site` or
 *  `Origin`. Tokens are for the deployments it cannot cover: a proxy that
 *  strips those headers, or a same-site but untrusted subdomain. Opt in
 *  with `form: { body, csrf: { token: true } }`.
 *
 *  The token is `<random>.<hmac of random>`, and the cookie holds that
 *  whole string. A submission has to present the same string again, in
 *  the hidden `_csrf` field or the `x-absolute-csrf` header, and it is
 *  accepted only when both hold: the signature is this server's, and the
 *  presented token equals the cookie.
 *
 *  Both checks are load-bearing. Without the equality check, any token
 *  this server ever signed — the attacker's own, from their own visit —
 *  would validate against a victim's cookie. Without the signature, a
 *  subdomain that can set a cookie on the parent domain could plant a
 *  value it knows and echo it back. Together they mean the sender had to
 *  read a cookie this server issued, which a cross-site page cannot do.
 *
 *  The server stores nothing: the signature is the whole memory.
 *
 *  The cookie is deliberately NOT HttpOnly. A pre-rendered page cannot
 *  embed a per-visitor token, so there the browser helpers read the cookie
 *  and send the header instead. Readable script-side costs nothing here:
 *  the cookie is the half an attacker already cannot forge a signature
 *  for.
 */

const PURPOSE = 'csrf';
const TOKEN_BYTES = 32;
/* Eight hours: long enough that a form left open over a working day still
 * submits, short enough that a leaked cookie stops being useful. */
const COOKIE_MAX_AGE_SECONDS = 28_800;

/* What was issued while answering one request: the cookie value, and
 * whether this request is the one that minted it (rather than arriving
 * with it already set).
 *
 * One map per process rather than per bundle — dist/index.js and each
 * framework entry carry their own copy of this module, exactly as
 * cspNonce.ts does, and a token minted by the renderer has to be visible
 * to the response hook that sets the cookie. */
type IssuedToken = { minted: boolean; value: string };

const ISSUED_KEY = Symbol.for('absolutejs.csrfIssued');

const issuedTokens = () => {
	const existing: unknown = Reflect.get(globalThis, ISSUED_KEY);
	if (existing instanceof WeakMap) return existing;
	const created = new WeakMap<Request, IssuedToken>();
	Reflect.set(globalThis, ISSUED_KEY, created);

	return created;
};

const cookieValue = (request: Request, name: string) => {
	const header = request.headers.get('cookie');
	if (!header) return undefined;
	for (const part of header.split(';')) {
		const [key, ...rest] = part.trim().split('=');
		if (key === name) return rest.join('=');
	}

	return undefined;
};

const tokenFor = (value: string | undefined) =>
	value === undefined ? undefined : { minted: false, value };

const mintToken = () => {
	const random = Buffer.from(
		crypto.getRandomValues(new Uint8Array(TOKEN_BYTES))
	).toString('base64url');

	return {
		minted: true,
		value: `${random}.${signValue(PURPOSE, random, signingSecret())}`
	};
};

/** The `Set-Cookie` value for a request that was given a new token while
 *  rendering, or undefined when it already had one (so a second tab does
 *  not have its cookie rotated out from under it).
 *
 *  Not HttpOnly, on purpose — see this module's header. */
export const csrfSetCookie = (request: Request, secure: boolean) => {
	const issued = issuedTokens().get(request);
	if (!issued?.minted) return undefined;

	return [
		`${CSRF_COOKIE_NAME}=${issued.value}`,
		'Path=/',
		'SameSite=Lax',
		`Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
		...(secure ? ['Secure'] : [])
	].join('; ');
};

/** Whether a token was handed out while answering this request, minted or
 *  not — meaning the page it is rendering embeds one visitor's token and
 *  must not be served to another from a shared cache. */
export const csrfTokenIssued = (request: Request) =>
	issuedTokens().has(request);

/** The token to put in a form's hidden `_csrf` field.
 *
 *  Mints it on first use for this request, the way `getCspNonce()` mints a
 *  nonce, so a renderer can ask for it without any route-level setup.
 *  Returns undefined when there is no request to bind to (build-time
 *  rendering), where a token would be meaningless — which is the case a
 *  pre-rendered page hits, and why the browser bindings fall back to
 *  reading the cookie. */
export const getCsrfToken = (
	request: Request | undefined = getCurrentAbsoluteRequest()
) => {
	if (!request) return undefined;
	const issued = issuedTokens();
	const existing =
		issued.get(request) ??
		tokenFor(cookieValue(request, CSRF_COOKIE_NAME)) ??
		mintToken();
	issued.set(request, existing);

	return existing.value;
};

/** Lets code that also ships to the browser reach this request's token
 *  without importing the request context or node:crypto: the framework
 *  components and `csrfField()` read it through
 *  `readCsrfToken()` (src/utils/csrfTokenRef.ts). Called by
 *  `formActions()`, the way `secureHeaders()` registers the nonce
 *  getter. */
export const registerCsrfToken = () => {
	registerCsrfTokenGetter(() => getCsrfToken());
};

/* A token is `<random>.<signature>`; anything else fails before the
 * secret is touched. */
const signedParts = (token: string) => {
	const separator = token.lastIndexOf('.');
	if (separator <= 0 || separator === token.length - 1) return undefined;

	return {
		signature: token.slice(separator + 1),
		value: token.slice(0, separator)
	};
};

/** Whether this submission presents the token its cookie was issued with.
 *
 *  The field is read from the parsed body (the no-JavaScript path) and the
 *  header from the request (the path a pre-rendered page takes, where no
 *  per-visitor field could be embedded). A submission with no cookie
 *  fails: there is nothing for it to match. */
export const verifyCsrfToken = (request: Request, body: unknown) => {
	const cookie = cookieValue(request, CSRF_COOKIE_NAME);
	const fromHeader = request.headers.get(CSRF_HEADER_NAME);
	const fromBody =
		body && typeof body === 'object' && CSRF_FIELD_NAME in body
			? Reflect.get(body, CSRF_FIELD_NAME)
			: undefined;
	const presented =
		fromHeader ?? (typeof fromBody === 'string' ? fromBody : undefined);
	if (!cookie || !presented || !constantTimeEquals(presented, cookie))
		return false;
	const parts = signedParts(presented);
	if (!parts) return false;

	return verifyValue(PURPOSE, parts.value, parts.signature, signingSecret());
};
