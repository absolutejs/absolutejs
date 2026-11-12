/* The page's CSP nonce, read back in the browser from an element the server
 * gave it to. Browsers hide the attribute's value but keep the `nonce`
 * property, so a script that runs can hand the nonce to the <style>/<script>
 * elements it creates; a nonce-based policy blocks them otherwise. Without
 * secureHeaders() there is no nonce and this does nothing.
 *
 * Lives in the dev client because that ships as raw TypeScript and may only
 * import from its own directory; the bundled client runtime
 * (src/client/prefetch.ts) imports it from here. */

export const applyPageNonce = <Element extends HTMLElement>(
	element: Element
) => {
	const nonce = readPageNonce();
	if (nonce) element.nonce = nonce;

	return element;
};

export const readPageNonce = () => {
	if (typeof document === 'undefined') return undefined;
	const carrier = document.querySelector<HTMLElement>(
		'script[nonce], style[nonce]'
	);

	return carrier?.nonce || undefined;
};
