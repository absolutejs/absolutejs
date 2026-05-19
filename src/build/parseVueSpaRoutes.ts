/** Extract SPA child routes from a Vue page's source.
 *
 *  Looks for `export const routes = defineRoutes([ ... ])` and parses
 *  each entry's `{ path, component: () => import('./X.vue') }` shape
 *  into a `{ path, importPath }` pair. The result drives the per-route
 *  CSS side-manifest emitted in `core/build.ts` so the SSR handler can
 *  inline the matched child route's compiled CSS (see
 *  `utils/spaRouteCss.ts` for the runtime side).
 *
 *  Regex-based on purpose: the supported shape is single-statement
 *  array-of-object-literals, which is the only form `defineRoutes` is
 *  documented to take. AST parsing would catch a few exotic edge cases
 *  but adds a dependency on every page compile; the failure mode of a
 *  miss is "child route CSS isn't inlined for that route", same as
 *  pre-feature behaviour, so a loose regex is the right trade-off. */

export type ParsedVueSpaRoute = {
	path: string;
	importPath: string;
};

const ROUTES_BLOCK_RE =
	/export\s+const\s+routes\s*=\s*defineRoutes\s*\(\s*\[([\s\S]*?)\]\s*\)\s*;?/;

const ROUTE_ENTRY_RE =
	/path:\s*['"`]([^'"`]+)['"`][\s\S]*?import\(\s*['"`]([^'"`]+\.vue)['"`]\s*\)/g;

export const parseVueSpaRoutes = (source: string): ParsedVueSpaRoute[] => {
	const blockMatch = source.match(ROUTES_BLOCK_RE);
	if (!blockMatch?.[1]) return [];
	const block = blockMatch[1];
	const entries: ParsedVueSpaRoute[] = [];
	for (const match of block.matchAll(ROUTE_ENTRY_RE)) {
		const [, path, importPath] = match;
		if (path && importPath) entries.push({ importPath, path });
	}

	return entries;
};
