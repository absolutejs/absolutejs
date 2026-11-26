/** Shared by every framework's page handler. */
export type PageSsrOption = {
	/** `false` skips the server render for this page: the server sends
	 *  the document shell — head, props, scripts — and the browser
	 *  renders the page.
	 *
	 *  For a page that cannot render on a server: one built on a library
	 *  that needs `window`, or a signed-in dashboard where the first
	 *  paint is a spinner either way. Everything around the render is
	 *  unchanged: the route's handler still runs per request, so props,
	 *  guards and redirects work as before.
	 *
	 *  What it costs is what server rendering gives. The response carries
	 *  no page content, so a crawler or a visitor without JavaScript sees
	 *  nothing, and the first paint waits for the bundle. Leave it on
	 *  unless the page cannot do without this. */
	ssr?: boolean;
};
