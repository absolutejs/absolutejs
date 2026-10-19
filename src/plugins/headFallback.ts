import type { AnyElysia } from 'elysia';

/**
 * Answers HEAD for every GET route: the same status and headers, no body.
 *
 * Elysia 2 no longer answers HEAD for a GET route, so every AbsoluteJS app
 * answered 404 to it -- pages and static files alike -- while GET answered
 * 200. Uptime monitors, link checkers, crawlers and validators ask with HEAD
 * and read that as down (absolutejs#76). An app's own `.head()` route still
 * wins over this fallback.
 */
export const headFallback = <A extends AnyElysia>(app: A) =>
	app.head('/*', async ({ request }: { request: Request }) => {
		const response = await app.handle(
			new Request(request.url, {
				headers: request.headers,
				method: 'GET'
			})
		);

		return new Response(null, {
			headers: response.headers,
			status: response.status,
			statusText: response.statusText
		});
	});
