/* `revalidatePath` and `revalidateAll`: re-render a pre-rendered page
 * now, because its data just changed.
 *
 * A route listed in `static.routes` is rendered once at build time and
 * served from a file. Until now the only thing that refreshed that file
 * was `static.revalidate`, a number of seconds: after a change the page
 * stayed wrong until the interval ran out, and an app that set none kept
 * the build's copy until the next deploy. These say "this page is stale"
 * at the moment the app knows it.
 *
 * The server that serves the files is the one that can re-render them,
 * so `prepare()` registers how; these functions find it through a global
 * rather than an import, which keeps them callable from a route handler
 * without a reference to the app. Where nothing is pre-rendered — dev,
 * or an app with no `static` config — there is nothing to refresh and
 * they say so by resolving to "nothing done". */

import type { RevalidateAllResult, Revalidator } from '../../types/revalidate';

const REVALIDATOR_KEY = Symbol.for('absolutejs.revalidator');

const isRevalidator = (value: unknown): value is Revalidator =>
	typeof value === 'object' &&
	value !== null &&
	'revalidate' in value &&
	typeof value.revalidate === 'function' &&
	'routes' in value &&
	typeof value.routes === 'function';

const currentRevalidator = () => {
	const value: unknown = Reflect.get(globalThis, REVALIDATOR_KEY);

	return isRevalidator(value) ? value : undefined;
};

/** @internal Called by `prepare()` once it knows the pre-rendered routes. */
export const registerRevalidator = (revalidator: Revalidator | undefined) => {
	if (revalidator) Reflect.set(globalThis, REVALIDATOR_KEY, revalidator);
	else Reflect.deleteProperty(globalThis, REVALIDATOR_KEY);
};

type Render = (route: string) => Promise<boolean>;

/** @internal One render per route at a time, and never a stale answer.
 *
 * Two callers asking for the same route share a render — but only a
 * render that STARTED after they asked. A render already under way began
 * before this caller's change and may have read the old data, so
 * joining it would report "fresh" for a page that is not. That caller is
 * given the next render instead, and every caller who arrives during the
 * same wait shares that one: a burst of requests for one route costs the
 * render in flight plus one more, however many they are. */
export const createRevalidationQueue = (render: Render) => {
	const inFlight = new Map<string, Promise<boolean>>();
	const queued = new Map<string, Promise<boolean>>();
	const start = (route: string) => {
		const done = render(route)
			.catch(() => false)
			.finally(() => {
				inFlight.delete(route);
			});
		inFlight.set(route, done);

		return done;
	};
	const startNext = (route: string, current: Promise<boolean>) => {
		const next = current.then(() => {
			queued.delete(route);

			return start(route);
		});
		queued.set(route, next);

		return next;
	};

	return {
		/** A render is under way for `route`. */
		isBusy: (route: string) => inFlight.has(route),
		revalidate: (route: string) => {
			const current = inFlight.get(route);
			if (!current) return start(route);

			return queued.get(route) ?? startNext(route, current);
		}
	};
};

/* `/blog/`, `/blog?x=1` and a full URL all name the route `/blog`. */
const routeOf = (path: string) => {
	const { pathname } = new URL(path, 'http://localhost');
	const trimmed = pathname.replace(/\/+$/, '');

	return trimmed === '' ? '/' : trimmed;
};

/** Re-render every pre-rendered page. Resolves to the routes that were
 *  replaced and the ones whose render failed, which keep their previous
 *  page. */
export const revalidateAll = async () => {
	const revalidator = currentRevalidator();
	const routes = revalidator?.routes() ?? [];
	const outcomes = await Promise.all(
		routes.map(async (route) => ({
			replaced: (await revalidator?.revalidate(route)) === true,
			route
		}))
	);
	const result: RevalidateAllResult = {
		failed: outcomes
			.filter(({ replaced }) => !replaced)
			.map(({ route }) => route),
		revalidated: outcomes
			.filter(({ replaced }) => replaced)
			.map(({ route }) => route)
	};

	return result;
};

/** Re-render the pre-rendered page at `path` now, and replace the file
 *  visitors are served.
 *
 *      await db.posts.update(id, changes);
 *      await revalidatePath(`/blog/${slug}`);
 *
 *  Resolves to `true` once the new page is in place, and to `false` when
 *  nothing was replaced: the path is not one of the pre-rendered routes,
 *  the render failed (the previous page stays), or the app has nothing
 *  pre-rendered at all, as in dev. It does not throw.
 *
 *  Await it to be sure the next request sees the new page; call it
 *  without awaiting to refresh in the background. */
export const revalidatePath = async (path: string) => {
	const revalidator = currentRevalidator();
	if (!revalidator) return false;
	const route = routeOf(path);
	if (!revalidator.routes().includes(route)) return false;

	return revalidator.revalidate(route);
};
