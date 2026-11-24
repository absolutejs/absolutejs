/** When a third-party script runs.
 *
 *  - `beforeInteractive` — in the document, not deferred, so it runs
 *    before the page hydrates. For the few scripts that must observe the
 *    page from the start: a consent manager, a bot or fraud check, an
 *    A/B-test flicker guard. It costs the page: the browser must fetch and
 *    run it before it finishes parsing.
 *  - `afterInteractive` (default) — in the document with `defer`, so it
 *    runs after parsing and does not block hydration. Analytics, tag
 *    managers, anything that only needs to see a finished page.
 *  - `lazyOnload` — nothing is rendered; the client inserts the tag once
 *    the window has loaded and the main thread is idle. Chat widgets,
 *    support bubbles, social embeds: things nobody needs in the first
 *    second. */
export type ScriptStrategy =
	'afterInteractive' | 'beforeInteractive' | 'lazyOnload';

export type ScriptProps = {
	/** URL of the script. Omit it for an inline script and pass `children`
	 *  (React, Svelte, Vue) or `code` instead. */
	src?: string;
	/** Identity across pages and navigations. Two tags with the same `id`
	 *  are the same script, so the second one does not run. Defaults to
	 *  `src`, which is the identity for all but an inline script — an
	 *  inline script with no `id` is treated as unique to its page. */
	id?: string;
	/** Defaults to `afterInteractive`. */
	strategy?: ScriptStrategy;
	/** Inline source, for a script with no `src`. */
	code?: string;
	/** `async` on the rendered tag. Ignored for `lazyOnload`, which is
	 *  already asynchronous, and meaningless with `defer`. */
	async?: boolean;
	/** `type` on the rendered tag. */
	type?: string;
	/** `crossorigin` on the rendered tag. */
	crossOrigin?: 'anonymous' | 'use-credentials';
	/** `referrerpolicy` on the rendered tag. The HTML values, so this is
	 *  the same set a React `<script>` accepts rather than any string. */
	referrerPolicy?:
		| ''
		| 'no-referrer'
		| 'no-referrer-when-downgrade'
		| 'origin'
		| 'origin-when-cross-origin'
		| 'same-origin'
		| 'strict-origin'
		| 'strict-origin-when-cross-origin'
		| 'unsafe-url';
	/** Subresource integrity hash. */
	integrity?: string;
	/** `data-*` attributes, which third-party tags commonly configure
	 *  themselves with. The key is the part after `data-`. */
	data?: Record<string, string>;
};
