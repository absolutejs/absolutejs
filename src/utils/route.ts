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

const fillSegment = (
	segment: string,
	params: Record<string, RouteParamValue | undefined>,
	path: string
) => {
	const match = PARAM_SEGMENT.exec(segment);
	if (!match) return segment;
	const [, name, optional] = match;
	if (name === undefined) return segment;
	const value = params[name];
	/* An optional segment with no value is dropped, which is the shorter
	 * of the paths an `[[optional]]` route registers. */
	if (value === undefined || value === '') {
		if (optional) return undefined;
		throw new Error(
			`route("${path}") is missing the "${name}" param. Pass it as route("${path}", { ${name}: … }).`
		);
	}

	return encodeValue(value);
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
	const given = params ?? {};
	const filled = path
		.split('/')
		.map((segment) => fillSegment(segment, given, path))
		.filter((segment) => segment !== undefined);
	const joined = filled.join('/');

	// Every path starts with `/`, and a path whose only segment was an
	// absent optional one collapses to nothing.
	return joined === '' ? '/' : joined;
};
