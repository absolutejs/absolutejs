/**
 * Serving an app under a URL prefix (`/studio/projects/abc`), behind a proxy
 * that strips the prefix before the request reaches the app.
 *
 * The app's routes, its dev module server and the HMR socket all stay at
 * the root of the app's own server: the proxy has already removed the
 * prefix. What changes is every URL the browser is handed, which must carry
 * the prefix to reach the app at all. The framework adds it where it hands
 * one out (a page's entry script, its route data, the HMR socket, CSS HMR),
 * and puts an import map first in the page's `<head>` so the root-absolute
 * module specifiers its bundles and dev modules use (`/@src/...`,
 * `/react/vendor/...`) resolve under the prefix too. `asset()` stays
 * unprefixed: the framework reads those paths from disk as well.
 *
 * Set per process with `ABSOLUTE_BASE_PATH`, or `basePath` in the config.
 */

/** Module URL prefixes that bundles and the dev module server write as
 *  root-absolute specifiers, which the import map moves under the base. */
export const BASE_PATH_MODULE_PREFIXES = [
	'/@src/',
	'/@stub/',
	'/@hmr/',
	'/@ng/',
	'/react/vendor/',
	'/vendor/',
	'/svelte/vendor/',
	'/vue/vendor/',
	'/angular/vendor/',
	'/ember/vendor/'
] as const;
export const getBasePath = () =>
	normalizeBasePath(process.env.ABSOLUTE_BASE_PATH);
export const normalizeBasePath = (raw: string | undefined) => {
	const trimmed = (raw ?? '').trim().replace(/^\/+|\/+$/g, '');

	return trimmed === '' ? '' : `/${trimmed}`;
};
export const withBasePath = (path: string, base = getBasePath()) => {
	if (base === '' || !path.startsWith('/') || path.startsWith('//'))
		return path;
	if (path === base || path.startsWith(`${base}/`)) return path;

	return `${base}${path}`;
};

const nonceAttribute = (nonce: string | undefined) =>
	nonce ? ` nonce="${nonce.replace(/"/g, '&quot;')}"` : '';

/**
 * What a page served under the base needs first in its `<head>`, before any
 * module script or modulepreload starts (an import map added after one has
 * is ignored): the import map, and the base for the browser-side code that
 * builds URLs itself (the HMR client). `''` when there is no base.
 */
export const basePathHeadTags = (base = getBasePath(), nonce?: string) => {
	if (base === '') return '';
	const imports = Object.fromEntries(
		BASE_PATH_MODULE_PREFIXES.map((prefix) => [prefix, `${base}${prefix}`])
	);
	const json = (value: unknown) =>
		JSON.stringify(value).replace(/</g, '\\u003c');

	// Both elements remove themselves once they have run. The browser keeps
	// an import map it has registered, and React never sees them when it
	// hydrates <head>: it pairs a page's own first inline <script> with the
	// first <script> it finds there, even one of another type, and the page
	// hydrates with a mismatch (React's own `importMap` option does the same).
	return `<script type="importmap" data-absolute-base-path${nonceAttribute(nonce)}>${json({ imports })}</script><script${nonceAttribute(nonce)}>window.__ABSOLUTE_BASE_PATH__=${json(base)};document.querySelector('script[data-absolute-base-path]')?.remove();document.currentScript?.remove();</script>`;
};

const HEAD_OPEN = /<head(\s[^>]*)?>/i;

/** Inserts `html` right after the first `<head>` of a streamed document. */
export const insertAfterHeadOpen = (
	body: ReadableStream<string | Uint8Array>,
	html: string
) => {
	if (html === '') return body;
	const decoder = new TextDecoder();
	const encoder = new TextEncoder();
	let pending = '';
	let done = false;

	const bytes = (chunk: string | Uint8Array) =>
		typeof chunk === 'string' ? encoder.encode(chunk) : chunk;

	return body.pipeThrough(
		new TransformStream<string | Uint8Array, Uint8Array>({
			flush(controller) {
				if (!done && pending)
					controller.enqueue(encoder.encode(pending));
			},
			transform(chunk, controller) {
				if (done) {
					controller.enqueue(bytes(chunk));

					return;
				}
				pending +=
					typeof chunk === 'string'
						? chunk
						: decoder.decode(chunk, { stream: true });
				const match = HEAD_OPEN.exec(pending);
				if (!match) return;
				const insertAt = match.index + match[0].length;
				controller.enqueue(
					encoder.encode(
						pending.slice(0, insertAt) +
							html +
							pending.slice(insertAt)
					)
				);
				pending = '';
				done = true;
			}
		})
	);
};
