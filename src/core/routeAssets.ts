/**
 * Read back what a page handler already put in its `<head>`.
 *
 * The web route-data representation (`application/vnd.absolute.route+json`,
 * see `src/mobile/pageProtocol.ts`) lists the assets a browser needs before
 * navigating to a page. Handlers already resolved those manifest keys —
 * they are sitting in the `<head>` string the handler is about to render —
 * so the route-data payload reads them back out instead of resolving the
 * manifest a second time.
 *
 * Input is a `<head>…</head>` document head or a bare head fragment (the
 * Svelte handler composes one), so both are parsed the same way.
 */

const LINK_TAG_RE = /<link\b[^>]*>/gi;
const REL_STYLESHEET_RE =
	/\brel\s*=\s*(?:"stylesheet"|'stylesheet'|stylesheet)(?=[\s/>])/i;
const HREF_RE = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i;
const TITLE_RE = /<title[^>]*>([\s\S]*?)<\/title>/i;

const ENTITIES: Record<string, string> = {
	'&#039;': "'",
	'&#39;': "'",
	'&amp;': '&',
	'&gt;': '>',
	'&lt;': '<',
	'&quot;': '"'
};
const ENTITY_RE = /&(?:amp|lt|gt|quot|#0?39);/g;

const decodeEntities = (value: string) =>
	value.replace(ENTITY_RE, (match) => ENTITIES[match] ?? match);

/** Every `<link rel="stylesheet">` href in a head string, deduped and in
 *  document order. */
export const readHeadStylesheets = (head: string | undefined) => {
	if (!head) return [];
	const hrefs = new Set<string>();
	for (const tag of head.match(LINK_TAG_RE) ?? []) {
		if (!REL_STYLESHEET_RE.test(`${tag} `)) continue;
		const href = HREF_RE.exec(tag);
		const value = href?.[1] ?? href?.[2] ?? href?.[3];
		if (value) hrefs.add(decodeEntities(value));
	}

	return [...hrefs];
};

/** The `<title>` text of a head string, when it has one. */
export const readHeadTitle = (head: string | undefined) => {
	if (!head) return undefined;
	const match = TITLE_RE.exec(head);
	const title =
		match?.[1] === undefined ? '' : decodeEntities(match[1]).trim();

	return title.length > 0 ? title : undefined;
};
