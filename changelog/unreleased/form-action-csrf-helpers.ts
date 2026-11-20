import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "A form with JavaScript now sends the token without any change to the page: submitFormAction, which every binding and enhanceForms goes through, adds the x-absolute-csrf header whenever the cookie is readable. Without JavaScript the token has to be in the markup, so each framework ships a field component: CsrfField for React and Vue, CsrfField.svelte, and <absolute-csrf-field /> for Angular. csrfField() returns the input markup for a hand-built HTML or HTMX page, csrfHeaders() the header object, and enhanceHtmxCsrf() attaches the header to HTMX's own requests. All of them read the token through readCsrfToken(), which answers from the request on the server and from the cookie in the browser, so a pre-rendered page can present a token it was never able to embed. The token itself is now <random>.<signature> and the cookie holds the whole string: a submission is accepted only when the signature is this server's and the token matches the cookie, which is what a browser can check for a page it did not render.",
	kind: 'added',
	summary:
		'CSRF token helpers for every framework, and the header for pre-rendered pages',
	symbols: [
		'csrfField',
		'csrfHeaders',
		'CsrfField',
		'CsrfFieldComponent',
		'enhanceHtmxCsrf',
		'getCsrfToken',
		'readCsrfToken'
	]
};
