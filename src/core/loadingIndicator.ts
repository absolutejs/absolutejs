import { Elysia } from 'elysia';
import { HTML_CONTENT_TYPE } from '../constants';
import { renderFirstLoadingFragment } from '../utils/resolveConvention';

/* Serves the `loading` convention to the navigation layer.
 *
 * The convention is markup the layer shows over the live document while a
 * soft navigation is in flight (`client/navigation.ts`). It is FETCHED
 * rather than inlined into every page: the per-framework scripts a page
 * handler embeds are written in seven different handlers, so inlining
 * would be seven edits and bytes on every response, for markup most
 * navigations never show. One route and one client fetch, warmed once per
 * session, costs nothing on a page that is never navigated away from.
 *
 * Rendered at most once per process. A 204 means the app ships no
 * `loading` convention, which the layer reads as "nothing to show" and
 * stops asking. */
export const LOADING_INDICATOR_PATH = '/__absolute/loading';

const NO_CONTENT = 204;

export const createLoadingIndicatorPlugin = () => {
	let fragment: Promise<string | null> | undefined;
	const get = () => (fragment ??= renderFirstLoadingFragment());

	return new Elysia({ name: 'absolutejs-loading-indicator' }).get(
		LOADING_INDICATOR_PATH,
		async () => {
			const html = await get();
			if (html === null)
				return new Response(null, { status: NO_CONTENT });

			return new Response(html, {
				headers: {
					/* The markup is fixed for the life of the process but
					 * changes with a deploy, and it is fetched once per
					 * session, so revalidation costs nothing and a stale
					 * indicator after a deploy is avoided. */
					'cache-control': 'no-cache',
					'content-type': HTML_CONTENT_TYPE
				}
			});
		}
	);
};
