import { existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { routeToFilename } from './prerenderPaths';

/* Which pre-rendered file answers a request, checked against the disk.
 *
 * The server kept a list of pre-rendered routes in memory, read once at
 * startup, and trusted it. That held while nothing changed the files
 * after startup. Since `revalidatePath` can delete a page and create one,
 * the list and the directory can disagree — and with `cluster` on they
 * do, because every worker has its own list and they all share one
 * directory:
 *
 * - a worker takes a page down; the others still list the route and
 *   answer it with a file that is gone, which is a 500;
 * - a worker creates a page; the others do not know and render it for
 *   every visitor, correct but uncached.
 *
 * So the disk is asked. A listed route whose file has gone is dropped
 * and the request is rendered as if it had never been cached. A path the
 * config covers that is not listed is looked for once per request, and
 * adopted if another worker has put it there.
 *
 * The cost is one `stat` on a request for a pre-rendered page, and one
 * on a miss for a path that could be one. Only a path that looks like a
 * page is looked for: under `routes: 'all'` every path is covered, and a
 * request for `/assets/app.js` should not go looking for a page. */

type PrerenderLookupOptions = {
	/** Whether a page may exist for a route that is not listed. */
	canCreate: (route: string) => boolean;
	prerenderDir: string;
	/** The routes known to be pre-rendered, and their files. Kept up to
	 *  date by the lookup as the disk contradicts it. */
	routes: Map<string, string>;
};

const looksLikeAPage = (pathname: string) =>
	!(pathname.split('/').pop() ?? '').includes('.');

export const createPrerenderLookup = ({
	canCreate,
	prerenderDir,
	routes
}: PrerenderLookupOptions) => {
	const root = resolve(prerenderDir);
	/* A request path is not trusted to stay inside the directory. */
	const fileFor = (pathname: string) => {
		const candidate = resolve(root, routeToFilename(pathname));

		return candidate.startsWith(`${root}${sep}`) ? candidate : undefined;
	};
	const adopt = (pathname: string) => {
		if (!looksLikeAPage(pathname) || !canCreate(pathname)) return undefined;
		const candidate = fileFor(pathname);
		if (!candidate || !existsSync(candidate)) return undefined;
		routes.set(pathname, candidate);

		return candidate;
	};

	return {
		/** The file to serve for `pathname`, or `undefined` to render. */
		fileFor: (pathname: string) => {
			const listed = routes.get(pathname);
			if (listed === undefined) return adopt(pathname);
			if (existsSync(listed)) return listed;
			routes.delete(pathname);

			return undefined;
		},
		/** Whether `pathname` has a page, in the list or on the disk —
		 *  so a page another worker created can still be taken down. */
		has: (pathname: string) => {
			if (routes.has(pathname)) return true;
			const candidate = fileFor(pathname);

			return candidate !== undefined && existsSync(candidate);
		}
	};
};
