/* Dependency-free access to the current request's CSP nonce, for code that
 * also ships to the browser (streaming slots, Angular components) and so
 * can't import the server's request context. `secureHeaders()` registers
 * the getter (src/core/cspNonce.ts); in the browser, or with secure headers
 * off, there is none and these return undefined / ''. */

const GETTER_KEY = Symbol.for('absolutejs.cspNonceGetter');

/** ` nonce="…"` for an inline <script>/<style> tag, or '' without one. */
export const nonceAttr = (nonce: string | undefined = readCspNonce()) =>
	nonce ? ` nonce="${nonce}"` : '';

/** Adds the nonce to the <style id="svelte-…"> tags Svelte renders into the
 *  head for components compiled with injected CSS. Only those: a <style>
 *  that arrived through {@html} stays without one. */
export const nonceSvelteHeadStyles = (
	head: string,
	nonce: string | undefined = readCspNonce()
) =>
	nonce
		? head.replace(
				/<style(?=\s+id="svelte-[^"]*")(?![^>]*\snonce=)/g,
				`<style nonce="${nonce}"`
			)
		: head;

export const readCspNonce = () => {
	const getter: unknown = Reflect.get(globalThis, GETTER_KEY);
	if (typeof getter !== 'function') return undefined;
	const nonce: unknown = getter();

	return typeof nonce === 'string' ? nonce : undefined;
};

export const registerCspNonceGetter = (getter: () => string | undefined) => {
	Reflect.set(globalThis, GETTER_KEY, getter);
};
