import { signValue, signingSecret, verifyValue } from '../utils/signingSecret';
import { getCurrentAbsoluteRequest } from './requestContext';

/** Signed double-submit CSRF tokens for `form` routes.
 *
 *  Phase 1's protection is the header check in formActions.ts, which is on
 *  by default and enough for a browser that sends `Sec-Fetch-Site` or
 *  `Origin`. Tokens are for the deployments it cannot cover: a proxy that
 *  strips those headers, or a same-site but untrusted subdomain. Opt in
 *  with `form: { body, csrf: { token: true } }`.
 *
 *  The cookie holds a random value; the form's hidden `_csrf` field (or
 *  the `x-absolute-csrf` header) holds this server's HMAC of it. Another
 *  site can make a browser post here, and the browser will attach the
 *  cookie, but that site can neither read the cookie nor compute the HMAC
 *  without the secret — so it cannot produce a matching pair. The server
 *  stores nothing: given the cookie and the field, the signature is the
 *  whole proof.
 *
 *  The cookie is deliberately NOT HttpOnly. A pre-rendered page cannot
 *  embed a per-visitor token, so there the browser helpers read the cookie
 *  and send the header instead. Readable script-side costs nothing here:
 *  the cookie is the half an attacker already cannot forge a signature
 *  for.
 */

const CSRF_COOKIE = 'absolute_csrf';
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

/** The hidden field the token travels in without JavaScript. */
export const CSRF_FIELD_NAME = '_csrf';
/** The header the browser bindings send it in instead. */
export const CSRF_HEADER_NAME = 'x-absolute-csrf';

const tokenFor = (value: string | undefined) =>
	value === undefined ? undefined : { minted: false, value };

const mintToken = () => ({
	minted: true,
	value: Buffer.from(
		crypto.getRandomValues(new Uint8Array(TOKEN_BYTES))
	).toString('base64url')
});

/** The `Set-Cookie` value for a request that was given a new token while
 *  rendering, or undefined when it already had one (so a second tab does
 *  not have its cookie rotated out from under it).
 *
 *  Not HttpOnly, on purpose — see this module's header. */
export const csrfSetCookie = (request: Request, secure: boolean) => {
	const issued = issuedTokens().get(request);
	if (!issued?.minted) return undefined;

	return [
		`${CSRF_COOKIE}=${issued.value}`,
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
 *  Mints the cookie value on first use for this request, the way
 *  `getCspNonce()` mints a nonce, so a renderer can ask for it without
 *  any route-level setup. Returns undefined when there is no request to
 *  bind to (build-time rendering), where a token would be meaningless. */
export const getCsrfToken = (
	request: Request | undefined = getCurrentAbsoluteRequest()
) => {
	if (!request) return undefined;
	const issued = issuedTokens();
	const existing =
		issued.get(request) ??
		tokenFor(cookieValue(request, CSRF_COOKIE)) ??
		mintToken();
	issued.set(request, existing);

	return signValue(PURPOSE, existing.value, signingSecret());
};

/** Whether this submission carries a token matching its cookie.
 *
 *  The field is read from the parsed body (the no-JavaScript path) and the
 *  header from the request (the pre-rendered path, where the page could
 *  not embed a field). A submission with no cookie fails: there is nothing
 *  to bind the signature to. */
export const verifyCsrfToken = (request: Request, body: unknown) => {
	const value = cookieValue(request, CSRF_COOKIE);
	if (!value) return false;
	const fromHeader = request.headers.get(CSRF_HEADER_NAME);
	const fromBody =
		body && typeof body === 'object' && CSRF_FIELD_NAME in body
			? Reflect.get(body, CSRF_FIELD_NAME)
			: undefined;
	const presented =
		fromHeader ?? (typeof fromBody === 'string' ? fromBody : undefined);
	if (!presented) return false;

	return verifyValue(PURPOSE, value, presented, signingSecret());
};
