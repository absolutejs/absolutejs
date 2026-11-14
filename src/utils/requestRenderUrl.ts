/* The path and query a page handler renders for (the `url` a router
 * matches), or undefined without a parsable request URL. Repeated slashes
 * collapse to one: a request for `//` (or `//x`) would otherwise reach the
 * router as a protocol-relative URL, which Angular's platform-server
 * rejects with NG05701 (a 500) and other routers misread as a host. */
export const requestRenderUrl = (request: Request | undefined) => {
	if (!request) return undefined;

	try {
		const parsed = new URL(request.url);

		return `${parsed.pathname.replace(/\/{2,}/g, '/')}${parsed.search}`;
	} catch {
		return undefined;
	}
};
