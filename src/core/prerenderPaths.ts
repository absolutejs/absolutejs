/* `/docs/guide` becomes `docs/guide.html`, not `docs-guide.html`.
 *
 * Flattening the separator was not reversible, and `prepare()` reverses it
 * on every boot: it lists this directory and rebuilds the route from the
 * file name. `docs-guide.html` reads back as `/docs-guide`, so a nested
 * route was never served from its own cache — it missed the map and
 * rendered dynamically on every request — while its HTML was served at a
 * URL nobody prerendered. Two routes could also land on one file: `/a/b`
 * and `/a-b` both wrote `a-b.html`, and whichever rendered last won.
 *
 * A path mirrors the URL instead, which is reversible, collision-free, and
 * what every static host already expects. `Bun.write` creates the
 * directories. */
/** The route a pre-rendered file serves, relative to the pre-render
 *  directory: the inverse of `routeToFilename`. */
export const filenameToRoute = (relativePath: string) => {
	const withoutExtension = relativePath.replace(/\.html$/, '');

	return withoutExtension === 'index' ? '/' : `/${withoutExtension}`;
};

export const routeToFilename = (route: string) =>
	route === '/' ? 'index.html' : `${route.slice(1)}.html`;
