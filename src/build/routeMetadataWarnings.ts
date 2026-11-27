import { readFileSync } from 'node:fs';
import { relative, sep } from 'node:path';
import { fileRoutesOf, type ScannedFileRoute } from './fileRoutes';

/* A page that writes its own `<title>` while its route sets one.
 *
 * A route's `metadata` is written into the head of the document the
 * server sends, replacing a title the page rendered there
 * (core/routeHead.ts). That is as far as the server reaches. A React or
 * Svelte page that renders a `<title>` renders it again in the browser,
 * and the framework underneath makes it the document's title — React
 * takes over the first `<title>` in the document and writes the
 * component's text into it — so once the page hydrates, the tab says
 * what the page wrote and not what the route set.
 *
 * Nothing sent from the server outlasts that, so the page is named here
 * instead, at build time, where it can be fixed by deleting a line. */

const METADATA_EXPORT_RE =
	/^[ \t]*export\s+(?:const|let|var|function|async\s+function)\s+metadata\b/m;
const TITLE_RE = /<title[\s>]/;

/* The frameworks whose page renders its own head, and so can say
 * something the route's metadata also says. */
const FRAMEWORKS = ['react', 'svelte'] as const;

const read = (path: string) => {
	try {
		return readFileSync(path, 'utf8');
	} catch {
		return '';
	}
};

const exportsMetadata = (path: string) => METADATA_EXPORT_RE.test(read(path));

const hasMetadata = (route: ScannedFileRoute) =>
	[...(route.guards ?? []), ...(route.server ? [route.server] : [])].some(
		exportsMetadata
	);

const toPosix = (path: string) => path.split(sep).join('/');

/** One message for each route file that renders a `<title>` and whose
 *  route, or a folder above it, exports `metadata`. */
export const routeMetadataWarnings = () => {
	const sources = FRAMEWORKS.flatMap((framework) => fileRoutesOf(framework))
		.filter((route) => hasMetadata(route))
		.filter((route) => TITLE_RE.test(read(route.source)))
		.map((route) => toPosix(relative(process.cwd(), route.source)));

	return [...new Set(sources)].map(
		(source) =>
			`${source} renders its own <title>, and its route sets a title through \`metadata\`. The document is sent with the route's, but the page puts its own back once it hydrates. Remove the <title> from the page.`
	);
};
