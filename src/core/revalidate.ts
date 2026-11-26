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

import type {
	RevalidateAllResult,
	RevalidationOutcome,
	Revalidator
} from '../../types/revalidate';

const REVALIDATOR_KEY = Symbol.for('absolutejs.revalidator');

const isRevalidator = (value: unknown): value is Revalidator =>
	typeof value === 'object' &&
	value !== null &&
	'revalidate' in value &&
	typeof value.revalidate === 'function' &&
	'routes' in value &&
	typeof value.routes === 'function' &&
	'canCreate' in value &&
	typeof value.canCreate === 'function';

const currentRevalidator = () => {
	const value: unknown = Reflect.get(globalThis, REVALIDATOR_KEY);

	return isRevalidator(value) ? value : undefined;
};

/** @internal One render per route at a time, and never a stale answer.
 *
 * Two callers asking for the same route share a render — but only a
 * render that STARTED after they asked. A render already under way began
 * before this caller's change and may have read the old data, so
 * joining it would report "fresh" for a page that is not. That caller is
 * given the next render instead, and every caller who arrives during the
 * same wait shares that one: a burst of requests for one route costs the
 * render in flight plus one more, however many they are. */
export const createRevalidationQueue = <Outcome>(
	render: (route: string) => Promise<Outcome>,
	/** What a render that threw counts as. */
	failed: Outcome
) => {
	const inFlight = new Map<string, Promise<Outcome>>();
	const queued = new Map<string, Promise<Outcome>>();
	const start = (route: string) => {
		const done = render(route)
			.catch(() => failed)
			.finally(() => {
				inFlight.delete(route);
			});
		inFlight.set(route, done);

		return done;
	};
	const startNext = (route: string, current: Promise<Outcome>) => {
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

/** @internal Called by `prepare()` once it knows the pre-rendered routes. */
export const registerRevalidator = (revalidator: Revalidator | undefined) => {
	if (revalidator) Reflect.set(globalThis, REVALIDATOR_KEY, revalidator);
	else Reflect.deleteProperty(globalThis, REVALIDATOR_KEY);
};

/* `/blog/`, `/blog?x=1` and a full URL all name the route `/blog`. */
const routeOf = (path: string) => {
	const { pathname } = new URL(path, 'http://localhost');
	const trimmed = pathname.replace(/\/+$/, '');

	return trimmed === '' ? '/' : trimmed;
};

const escapeForRegExp = (text: string) =>
	text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* One segment of a `static.routes` path as a piece of a regular
 * expression: `:name` is exactly one segment, `:name?` is one or none,
 * `*` is the folder — the path before it and everything below, which is
 * what the same pattern selects at build time. */
const segmentPattern = (segment: string) => {
	if (segment === '*') return '(?:/.+)?';
	if (!segment.startsWith(':')) return `/${escapeForRegExp(segment)}`;

	return segment.endsWith('?') ? '(?:/[^/]+)?' : '/[^/]+';
};

const patternOf = (path: string) =>
	new RegExp(
		`^${path.split('/').filter(Boolean).map(segmentPattern).join('')}/?$`
	);

const isPattern = (path: string) => /[:*]/.test(path);

/** @internal Whether a path that is NOT pre-rendered may become so.
 *
 * The set of pre-rendered pages used to be fixed when the server
 * started, so a post published after the deploy was rendered for every
 * visitor and could not be given a file. A page may now be created for
 * any path `static.routes` covers: one it lists, one a pattern in it
 * matches, or any at all under `routes: 'all'`. Nothing outside that —
 * the config is still what says which routes are static. */
export const createStaticRouteMatcher = (
	routes: readonly string[] | 'all' | undefined
) => {
	if (routes === undefined) return () => false;
	if (routes === 'all') return () => true;
	const literal = new Set(routes.filter((path) => !isPattern(path)));
	const patterns = routes.filter(isPattern).map(patternOf);

	return (route: string) =>
		literal.has(route) || patterns.some((pattern) => pattern.test(route));
};

/** Re-render every pre-rendered page. Resolves to the routes whose page
 *  was replaced, the ones that are no longer pages and were taken out of
 *  the cache, and the ones whose render failed, which keep their
 *  previous page. */
export const revalidateAll = async () => {
	const revalidator = currentRevalidator();
	const routes = revalidator?.routes() ?? [];
	const outcomes = await Promise.all(
		routes.map(async (route) => ({
			outcome: (await revalidator?.revalidate(route)) ?? 'failed',
			route
		}))
	);
	const routesThat = (wanted: RevalidationOutcome) =>
		outcomes
			.filter(({ outcome }) => outcome === wanted)
			.map(({ route }) => route);
	const result: RevalidateAllResult = {
		failed: routesThat('failed'),
		removed: routesThat('removed'),
		revalidated: routesThat('replaced')
	};

	return result;
};

/** Make the pre-rendered copy of `path` match what the app serves now.
 *
 *      await db.posts.update(id, changes);
 *      await revalidatePath(`/blog/${slug}`);
 *
 *  The page is rendered again, and then:
 *
 *  - it rendered: the file visitors are served is replaced — or
 *    created, for a page that did not exist when the app was built and
 *    whose path `static.routes` covers;
 *  - it is no longer a page (a 404, a 410, a redirect): its file is
 *    deleted and the route is rendered per request from then on.
 *
 *  Resolves to `true` in both cases, and to `false` when nothing
 *  changed: the path is not one `static.routes` covers, the render
 *  failed (the previous page stays), there was no page and still is
 *  none, or the app pre-renders nothing at all, as in dev. It does not
 *  throw.
 *
 *  Await it to be sure the next request sees the result; call it
 *  without awaiting to do it in the background. */
export const revalidatePath = async (path: string) => {
	const revalidator = currentRevalidator();
	if (!revalidator) return false;
	const route = routeOf(path);
	const known =
		revalidator.routes().includes(route) || revalidator.canCreate(route);
	if (!known) return false;

	return (await revalidator.revalidate(route)) !== 'failed';
};
