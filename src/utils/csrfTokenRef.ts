/* Dependency-free access to the current request's CSRF token, for code
 * that also ships to the browser (the four framework bindings, the plain
 * `enhanceForms` runtime) and so can't import the server's request
 * context or node:crypto.
 *
 * On the server `formActions()` registers the getter (src/core/csrfToken.ts
 * mints through the request context, exactly as the CSP nonce does in
 * src/utils/cspNonceRef.ts). In the browser there is no getter, and the
 * token is read from the cookie instead — the token IS the cookie's value,
 * so both sides arrive at the same string, which is what lets a
 * pre-rendered page send a header it could never have embedded as a
 * field.
 *
 * With tokens off, or nothing to read, these return undefined / '' and a
 * form renders exactly as before. */

const GETTER_KEY = Symbol.for('absolutejs.csrfTokenGetter');

/** The cookie the token travels in. Not HttpOnly: a pre-rendered page has
 *  to read it to send the header. */
export const CSRF_COOKIE_NAME = 'absolute_csrf';
/** The hidden field a server-rendered form carries the token in. */
export const CSRF_FIELD_NAME = '_csrf';
/** The header the browser bindings send it in. */
export const CSRF_HEADER_NAME = 'x-absolute-csrf';

/* The token is base64url plus one dot, so this never fires for one this
 * server minted — it is here so a hand-built token, or a stray cookie,
 * cannot break out of the attribute. */
const escapeAttribute = (value: string) =>
	value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

const fromCookie = () => {
	if (typeof document === 'undefined') return undefined;
	for (const part of document.cookie.split(';')) {
		const [key, ...rest] = part.trim().split('=');
		if (key === CSRF_COOKIE_NAME) return rest.join('=');
	}

	return undefined;
};

/** `<input type="hidden" name="_csrf" value="…">` for a hand-written form
 *  — an HTML or HTMX page's template, Svelte's `{@html}`, a string
 *  builder — or '' when there is no token.
 *
 *  The four framework bindings have a component for this; reach for the
 *  markup only where you are assembling HTML yourself. */
export const csrfField = (token: string | undefined = readCsrfToken()) =>
	token
		? `<input type="hidden" name="${CSRF_FIELD_NAME}" value="${escapeAttribute(token)}">`
		: '';

/** The header a fetch submission should carry, or `{}` without a token.
 *  `submitFormAction` already sends it; this is for a hand-rolled fetch,
 *  or for HTMX through `htmx:configRequest`. */
export const csrfHeaders = (token: string | undefined = readCsrfToken()) =>
	token ? { [CSRF_HEADER_NAME]: token } : {};

/** The token for the page being rendered (server) or shown (browser), or
 *  undefined when this app issues none. */
export const readCsrfToken = () => {
	const getter: unknown = Reflect.get(globalThis, GETTER_KEY);
	if (typeof getter !== 'function') return fromCookie();
	const token: unknown = getter();

	return typeof token === 'string' ? token : undefined;
};

export const registerCsrfTokenGetter = (getter: () => string | undefined) => {
	Reflect.set(globalThis, GETTER_KEY, getter);
};
