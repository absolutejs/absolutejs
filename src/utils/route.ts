import type {
	AbsoluteRoutePath,
	RouteParamsArgs,
	RouteParamValue
} from '../../types/routeMap';

/* Building a URL for one of the project's routes, with the path and its
 * params both checked — see types/routeMap.ts for why this is a function
 * rather than a typed `href`.
 *
 * No generated code is imported to make this work: the route map is types
 * only, so `route()` is an ordinary function with no runtime dependency
 * on the build, and it runs the same on a server, in a client bundle and
 * in a test. */

const PARAM_SEGMENT = /^:(.+?)(\?)?$/;

/* Each param value is encoded per `/`-separated part, so a `/` inside a
 * value stays a path separator.
 *
 * That is what a `[...catchAll]` route needs — `route('/docs/:rest', {
 * rest: 'guide/routing' })` has to come out as `/docs/guide/routing` — and
 * the typed path cannot say which param is the catch-all one: `[...rest]`
 * and `[rest]` are both typed `:rest`. So the rule is uniform rather than
 * per-param, which also makes it the same rule a template string follows
 * today, minus the missing encoding. A value with a `/` in it that was
 * NOT meant as a catch-all therefore becomes two segments and will not
 * match — visible immediately, where silently encoding it to `%2F` would
 * produce a URL that 404s for a reason nobody can see. */
const encodeValue = (value: RouteParamValue) =>
	String(value).split('/').map(encodeURIComponent).join('/');

/** A filled path, or the name of the param that had no value. Separate
 *  from `route()` because the sitemap fills the same paths and wants to
 *  SKIP a route it cannot fill rather than throw: a dynamic route whose
 *  `entries()` omits a param is one URL missing from a sitemap, not a
 *  reason to fail a build. */
type SegmentFill =
	| { kind: 'drop' }
	| { kind: 'keep'; value: string }
	| { kind: 'missing'; name: string };

const fillSegment = (
	segment: string,
	params: Record<string, RouteParamValue | undefined>
) => {
	const match = PARAM_SEGMENT.exec(segment);
	const [, name, optional] = match ?? [];
	if (!match || name === undefined) {
		const literal: SegmentFill = { kind: 'keep', value: segment };

		return literal;
	}
	const value = params[name];
	if (value !== undefined && value !== '') {
		const given: SegmentFill = { kind: 'keep', value: encodeValue(value) };

		return given;
	}

	/* An optional segment with no value is dropped, which is the shorter
	 * of the paths an `[[optional]]` route registers. */
	const absent: SegmentFill = optional
		? { kind: 'drop' }
		: { kind: 'missing', name };

	return absent;
};

export const fillRoutePath = (
	path: string,
	params: Record<string, RouteParamValue | undefined>
): { missing: string } | { url: string } => {
	const filled: string[] = [];
	for (const segment of path.split('/')) {
		const result = fillSegment(segment, params);
		if (result.kind === 'missing') return { missing: result.name };
		if (result.kind === 'keep') filled.push(result.value);
	}
	const joined = filled.join('/');

	// Every path starts with `/`, so a path whose only segment was an
	// absent optional one collapses to nothing.
	return { url: joined === '' ? '/' : joined };
};

/** The URL for one of the project's routes.
 *
 *  ```ts
 *  route('/pricing');
 *  route('/blog/:slug', { slug: post.slug });
 *  route('/:lang?/about', { lang: undefined }); // → /about
 *  ```
 *
 *  The path is checked against the project's routes and the params
 *  against that path's own segments, so a renamed `[slug]` fails every
 *  call site rather than 404ing at runtime. A project with no generated
 *  route map accepts any path, so this is usable before `fileRoutes` is
 *  turned on.
 *
 *  A query string or hash is the caller's to append: this builds the path
 *  a route is registered at, and nothing about `?` or `#` is checkable
 *  from the route map. */
export const route = <Path extends AbsoluteRoutePath>(
	path: Path,
	...args: RouteParamsArgs<Path>
) => {
	const [params] = args;
	const filled = fillRoutePath(path, params ?? {});
	if ('missing' in filled)
		throw new Error(
			`route("${path}") is missing the "${filled.missing}" param. Pass it as route("${path}", { ${filled.missing}: … }).`
		);

	return filled.url;
};
